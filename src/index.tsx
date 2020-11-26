import {
  catchError,
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
import { fromFetch } from 'rxjs/fetch';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  pending: boolean;
  result?: T;
  error?: ERR;
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
            setTimeout(() => {
              this.trigger.next();
            }, 0);
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

export function observeAsync<T, ERR = unknown>(): OperatorFunction<
  AsyncFactory<T>,
  AsyncResult<T, ERR>
> {
  return (source): Observable<AsyncResult<T, ERR>> => {
    const observer = new FactoryObserver();
    let isComplete = false;
    let lastResult: T | undefined = undefined;
    return combineLatest([
      source.pipe(finalize(() => (isComplete = true))),
      observer.trigger.pipe(startWith(0)),
    ]).pipe(
      exhaustMapWithTrailing(([factory]) => {
        const keys: symbol[] = [];
        const result = factory(input => {
          return observer.observe(input, key => keys.push(key));
        });
        if (lastResult === undefined) {
          return from(result).pipe(
            tap(item => {
              observer.unsubscribe(keys);
              lastResult = item;
            }),
            map(result => ({ pending: false, result })),
            catchError(err => of({ pending: false, error: err as ERR }))
          );
        }
        return from(result).pipe(
          tap(item => {
            observer.unsubscribe(keys);
            lastResult = item;
          }),
          map(result => ({ pending: false, result })),
          startWith({ pending: true, result: lastResult }),
          catchError(err =>
            of({ pending: false, error: err as ERR, result: lastResult })
          )
        );
      }),
      tap(() => {
        if (observer.isComplete() && isComplete) {
          observer.trigger.complete();
        }
      }),

      finalize<AsyncResult<T, ERR>>(() => {
        observer.unsubscribe();
        observer.trigger.complete();
      })
    );
  };
}

class Monitor {
  usingPending = false;
  usingError = false;

  wrap<T, ERR>(result: AsyncResultWithRefresh<T, ERR>) {
    if (this.usingPending && this.usingError) {
      return result;
    }
    return new Proxy(result, {
      get: (target, prop, receiver) => {
        switch (prop) {
          case 'pending':
            this.usingPending = true;
            break;
          case 'error':
            this.usingError = true;
            break;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
}

export type AsyncResultWithRefresh<T, ERR> = AsyncResult<T, ERR> & {
  refresh: () => Promise<T>;
};

export function useAsync<T, ERR>(
  factory: AsyncFactory<T>,
  dependencies: unknown[]
): AsyncResultWithRefresh<T, ERR> {
  const callback = useCallback(factory, dependencies);
  const monitor = useMemo(() => new Monitor(), []);
  const [factories, refresh] = useObservedProp(callback);
  const observable = useMemo(() => {
    return factories.pipe(observeAsync<T, ERR>(), publishReplay(1), refCount());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);
  const handleRefresh = useCallback(() => {
    function guard(item: any): item is T {
      return item !== undefined;
    }
    const promise = observable
      .pipe(
        skip(1),
        map(item => item.result),
        filter<T | undefined, T>(guard),
        take(1)
      )
      .toPromise();
    refresh((v: AsyncFactory<T>) => v);
    return promise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observable, refresh]);
  const [output, setOutput] = useState<AsyncResult<T, ERR>>({ pending: true });
  useEffect(() => {
    const sub = observable.subscribe(item => {
      if (item.pending) {
        if (monitor.usingPending) {
          setOutput(item);
        }
      } else {
        setOutput(item);
      }
    });
    return () => sub.unsubscribe();
  }, [observable, monitor]);
  const final = useMemo(
    () =>
      monitor.wrap({
        ...output,
        refresh: handleRefresh,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monitor, output, handleRefresh]
  );
  if (!monitor.usingError) {
    if (output.error !== undefined) {
      throw output.error;
    }
  }
  return final;
}

export function useConnectableSubscribe<T>(
  observable: Observable<T>,
  initialValue: T
): [T, () => void] {
  const activator = useMemo(() => new Subject(), []);
  const [state, setState] = useState<T>(initialValue);
  const activate = useCallback(() => {
    if (activator.isStopped) {
      return;
    }
    activator.next(0);
    activator.complete();
  }, [activator]);
  useEffect(() => {
    if (activator.isStopped) {
      const sub = observable.subscribe(setState);
      return () => sub.unsubscribe();
    }
    const sub = activator.pipe(switchMap(() => observable)).subscribe(setState);
    return () => sub.unsubscribe();
  }, [activator, observable]);
  return [state, activate];
}

export function useSubscribe<T>(observable: Observable<T>, initialValue: T): T {
  const [state, setState] = useState(initialValue);
  useEffect(() => {
    const sub = observable.subscribe(setState);
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
      (store[key] = of(factory(input)).pipe(
        observeAsync<OUTPUT, ERR>(),
        finalize(() => delete store[key]),
        publishReplay(1),
        refCount()
      ))
    );
  };
  return Object.assign(getResource, {
    useSubscribe(input: INPUT) {
      const resource = getResource(input);
      return useSubscribe(resource, { pending: true });
    },
  });
}

export type SharedObservable<OUTPUT, INPUT extends unknown[]> = {
  (...input: INPUT): Observable<OUTPUT>;
  refresh(...input: INPUT): Promise<OUTPUT | undefined>;
};

export function createSharedObservable<OUTPUT, INPUT extends unknown[]>({
  factory,
  getKey,
}: {
  factory: (...inputs: INPUT) => Observable<OUTPUT>;
  getKey: (...input: INPUT) => string;
}): SharedObservable<OUTPUT, INPUT> {
  const store: { [key: string]: Observable<OUTPUT> } = {};
  const refreshTokens: { [key: string]: Subject<void> } = {};
  const getResource = (...input: INPUT) => {
    const key = getKey(...input);
    if (!store[key]) {
      if (refreshTokens[key] && !refreshTokens[key].isStopped) {
        refreshTokens[key].complete();
      }
      const refresh = (refreshTokens[key] = new Subject());
      store[key] = refresh.pipe(
        startWith(0),
        exhaustMapWithTrailing(() => factory(...input)),
        finalize(() => {
          delete store[key];
          refresh.complete();
          delete refreshTokens[key];
        }),
        publishReplay(1),
        refCount()
      );
    }
    return store[key];
  };
  return Object.assign(getResource, {
    refresh(...input: INPUT) {
      const key = getKey(...input);
      const refresh = refreshTokens[key];
      if (!refresh) {
        return Promise.resolve(undefined);
      }
      const obs = store[key];
      if (!obs) {
        return Promise.resolve(undefined);
      }
      const res = obs.pipe(take(1)).toPromise();
      refresh.next();
      return res;
    },
  });
}

export function useObservedProp<A>(
  a: A
): [Observable<A>, (value: A | ((prev: A) => A)) => void] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subject = useMemo(() => new BehaviorSubject<A>(a), []);
  useEffect(() => {
    if (subject.value !== a) {
      subject.next(a);
    }
  }, [a, subject]);
  useEffect(() => () => subject.complete(), [subject]);
  return useMemo(
    () => [
      subject.asObservable(),
      value => {
        if (value instanceof Function) {
          subject.next(value(subject.value));
        } else {
          subject.next(value);
        }
      },
    ],
    [subject]
  );
}

export function createSharedState<T>(initialValue: T) {
  const subject = new BehaviorSubject(initialValue);
  const setState = (value: T | ((prev: T) => T)) => {
    if (value instanceof Function) {
      subject.next(value(subject.value));
    } else {
      subject.next(value);
    }
  };
  return Object.assign(subject.asObservable(), {
    useState() {
      return [useSubscribe(subject, subject.value), setState];
    },
    setState,
  });
}

export type SharedFetch<INPUT extends unknown[], OUTPUT, ERR = unknown> = {
  (...input: INPUT): Observable<AsyncResult<OUTPUT, ERR>>;
  useSubscribe(...input: INPUT): AsyncResult<OUTPUT, ERR>;
};

export function createSharedFetch<T, INPUT extends unknown[]>(
  init$: Observable<RequestInit>,
  request: (...input: INPUT) => string,
  selector: (response: Response) => Promise<T>
): SharedFetch<INPUT, T> {
  const shared = createSharedAsync({
    factory(input: string) {
      return async observe => {
        const init = await observe(init$);
        return observe(
          fromFetch(input, {
            ...init,
            selector,
          })
        );
      };
    },
    getKey(input: string) {
      return input;
    },
  });
  return Object.assign(
    (...input: INPUT) => {
      const url = request(...input);
      return shared(url);
    },
    {
      useSubscribe(...input: INPUT) {
        const url = request(...input);
        return shared.useSubscribe(url);
      },
    }
  );
}
