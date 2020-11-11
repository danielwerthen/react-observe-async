import {
  catchError,
  exhaustMap,
  filter,
  finalize,
  map,
  publishReplay,
  skip,
  startWith,
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
  refresh: () => Promise<T>;
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
  const observer = new FactoryObserver();
  const lastResult = new BehaviorSubject<T | undefined>(undefined);
  const refreshTrigger = new Subject();
  const refresh = () => {
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
}
