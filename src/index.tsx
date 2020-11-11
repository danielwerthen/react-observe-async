import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  publishReplay,
  refCount,
  skip,
  startWith,
  switchMap,
  take,
  tap,
  throttle,
} from 'rxjs/operators';
import {
  BehaviorSubject,
  combineLatest,
  ConnectableObservable,
  from,
  Observable,
  ObservableInput,
  of,
  OperatorFunction,
  Subject,
  Subscription,
} from 'rxjs';
import { useEffect, useMemo, useState } from 'react';

/**
 * Credit to: https://github.com/ReactiveX/rxjs/issues/5004
 * @param project
 */
function exhaustMapWithTrailing<T, R>(
  project: (value: T, index: number) => ObservableInput<R>
): OperatorFunction<T, R> {
  return (source): Observable<R> => {
    const release = new Subject();

    return source.pipe(
      throttle(() => release, {
        leading: true,
        trailing: true,
      }),
      exhaustMap((value, index) =>
        from(project(value, index)).pipe(
          finalize(() => {
            release.next();
          })
        )
      )
    );
  };
}

export type AsyncResult<T, ERR> = {
  pending?: boolean;
  result?: T;
  error?: ERR;
  refresh: () => Promise<T | undefined>;
};

export type ObserveValue = <T>(input: Observable<T>) => Promise<T>;

export type AsyncFactory<T> = (observe: ObserveValue) => Promise<T>;

function getSymbol<A>(target: any, sym: symbol, factory?: () => A): A {
  if (!target[sym] && factory) {
    target[sym] = factory();
  }
  return target[sym];
}

function deleteSymbol(target: any, sym: symbol) {
  delete target[sym];
}

class FactoryObserver {
  _store = {};
  _tracker = Symbol('Factory observer tracking token');
  trigger = new Subject();

  observe<T>(input: Observable<T>, record: (sym: symbol) => void): Promise<T> {
    const token = getSymbol(input, this._tracker, () =>
      Symbol('Factory observer subscription token')
    ) as symbol;
    const [observable] = getSymbol(this._store, token, () => {
      let sub: Subscription;
      const observable = input.pipe(
        finalize(() => sub.unsubscribe()),
        publishReplay(1)
      ) as ConnectableObservable<T>;
      sub = observable
        .pipe(
          skip(1),
          tap(() => {
            this.trigger.next();
          })
        )
        .subscribe();
      return [observable, observable.connect()];
    }) as [ConnectableObservable<T>, Subscription];
    record(token);
    return observable.pipe(take(1)).toPromise();
  }

  isComplete(): boolean {
    const impleted = Object.getOwnPropertySymbols(this._store).map(token => {
      const stored = getSymbol(this._store, token) as [
        ConnectableObservable<unknown>,
        Subscription
      ];
      return stored[0]._isComplete;
    });
    return !impleted.some(r => !r);
  }

  unsubscribe(except?: symbol[]) {
    Object.getOwnPropertySymbols(this._store).forEach(token => {
      if (except && except.includes(token)) {
        return;
      }
      const stored = getSymbol(this._store, token) as [
        ConnectableObservable<unknown>,
        Subscription
      ];
      if (stored) {
        stored[1].unsubscribe();
      }
      deleteSymbol(this._store, token);
    });
  }
}

export function observeAsync<T, ERR = unknown>(
  factories: Observable<AsyncFactory<T>>
): Observable<AsyncResult<T, ERR>> {
  return of(0).pipe(
    switchMap(() => {
      const observer = new FactoryObserver();
      const lastResult = new BehaviorSubject<T | undefined>(undefined);
      const refreshTrigger = new Subject();
      const refresh = () => {
        if (lastResult.isStopped) {
          return Promise.resolve(lastResult.value);
        }
        refreshTrigger.next();
        function guard(item: any): item is T {
          return item !== undefined;
        }
        return lastResult
          .pipe(skip(1), filter<T | undefined, T>(guard), take(1))
          .toPromise();
      };
      let isComplete = false;
      return combineLatest([
        factories.pipe(finalize(() => (isComplete = true))),
        observer.trigger.pipe(startWith(0)),
        refreshTrigger.pipe(startWith(0)),
      ]).pipe(
        exhaustMapWithTrailing(([factory]) => {
          const keys: symbol[] = [];
          const result = factory(input => {
            return observer.observe(input, key => keys.push(key));
          });
          return from(result).pipe(tap(() => observer.unsubscribe(keys)));
        }),
        tap(result => lastResult.next(result)),
        map(result => ({ result })),
        catchError(err => of({ error: err as ERR })),
        startWith({
          pending: true,
          ...(lastResult.value !== undefined && { result: lastResult.value }),
        }),
        map(res => ({
          ...res,
          refresh,
        })),
        tap(() => {
          if (observer.isComplete() && isComplete) {
            observer.trigger.complete();
            refreshTrigger.complete();
            lastResult.complete();
          }
        }),

        finalize<AsyncResult<T, ERR>>(() => {
          observer.unsubscribe();
          observer.trigger.complete();
          refreshTrigger.complete();
          lastResult.complete();
        })
      );
    })
  );
}

export function useSubscribe<T>(observable: Observable<T>, initialValue: T): T {
  const [state, setState] = useState(initialValue);
  useEffect(() => {
    const sub = observable.pipe(distinctUntilChanged()).subscribe(setState);
    return () => sub.unsubscribe();
  }, [observable]);
  return state;
}

export type SharedAsync<INPUT, OUTPUT, ERR = unknown> = {
  (input: INPUT): Observable<AsyncResult<OUTPUT, ERR>>;
  useSubscribe(input: INPUT): AsyncResult<OUTPUT, ERR>;
};

export function createSharedAsync<INPUT, OUTPUT, ERR = unknown>({
  factory,
  getKey,
}: {
  factory: (input: INPUT) => AsyncFactory<OUTPUT>;
  getKey: (input: INPUT) => string;
}): SharedAsync<INPUT, OUTPUT, ERR> {
  const store: { [key: string]: Observable<AsyncResult<OUTPUT, ERR>> } = {};
  const getResource = (input: INPUT) => {
    const key = getKey(input);
    return (
      store[key] ||
      (store[key] = observeAsync<OUTPUT, ERR>(of(factory(input))).pipe(
        finalize(() => delete store[key]),
        publishReplay(1),
        refCount()
      ))
    );
  };
  return Object.assign(getResource, {
    useSubscribe(input: INPUT) {
      const resource = getResource(input);
      return useSubscribe(resource, {
        pending: true,
        refresh: async () => {
          const res = await resource.pipe(take(1)).toPromise();
          return await res.refresh();
        },
      });
    },
  });
}

export function useObservedProp<A>(a: A): BehaviorSubject<A> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subject = useMemo(() => new BehaviorSubject<A>(a), []);
  useEffect(() => {
    if (subject.value !== a) {
      subject.next(a);
    }
  }, [a, subject]);
  useEffect(() => () => subject.complete(), [subject]);
  return subject;
}
