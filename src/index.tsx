import {
  catchError,
  concatMap,
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
} from 'rxjs/operators';
import {
  BehaviorSubject,
  combineLatest,
  ConnectableObservable,
  from,
  Observable,
  of,
  OperatorFunction,
  Subject,
  Subscription,
} from 'rxjs';
import { fromFetch as defaultFromFetch } from 'rxjs/fetch';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exhaustMapWithTrailing } from './exhaustMapWithTrailing';

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

  wrap<AR extends AsyncResult<unknown, unknown>>(result: AR): AR {
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

export function observeAsyncWithRefresh<T, ERR = unknown>(
  factories: Observable<AsyncFactory<T>>,
  finalizeFn: () => void = () => void 0
): [Observable<AsyncResult<T, ERR>>, () => Promise<T>] {
  const refreshTrigger = new Subject();
  const root = refreshTrigger.pipe(
    startWith(0),
    switchMap(() => factories),
    observeAsync<T, ERR>(),
    finalize(finalizeFn),
    publishReplay(1),
    refCount()
  );
  const refresh = () => {
    function guard(item: any): item is T {
      return item !== undefined;
    }
    const promise = root
      .pipe(
        skip(1),
        map(item => item.result),
        filter<T | undefined, T>(guard),
        take(1)
      )
      .toPromise();
    refreshTrigger.next();
    return promise;
  };
  return [root, refresh];
}

export function useAsync<T, ERR>(
  factory: AsyncFactory<T>,
  dependencies: unknown[]
): AsyncResultWithRefresh<T, ERR> {
  const callback = useCallback(factory, dependencies);
  const monitor = useMemo(() => new Monitor(), []);
  const factories = useObservedProp(callback);
  const [observable, handleRefresh] = useMemo(() => {
    return observeAsyncWithRefresh<T, ERR>(factories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);
  const [output, setOutput] = useState<AsyncResult<T, ERR>>({ pending: true });
  const outputRef = useRef<AsyncResult<T, ERR>>(output);
  outputRef.current = output;
  useEffect(() => {
    const sub = observable.subscribe(item => {
      if (item.pending) {
        if (monitor.usingPending) {
          setOutput(item);
        }
      } else {
        const old = outputRef.current;
        if (
          old.result !== item.result ||
          old.error !== item.error ||
          old.pending !== item.pending
        ) {
          setOutput(item);
        }
      }
    });
    return () => sub.unsubscribe();
  }, [observable, monitor, outputRef]);
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

export function useSubscribe<T>(observable: Observable<T>, initialValue: T): T {
  const [state, setState] = useState(initialValue);
  useEffect(() => {
    const sub = observable.subscribe(setState);
    return () => sub.unsubscribe();
  }, [observable]);
  return state;
}

export type SharedAsync<OUTPUT, ERR = unknown> = Observable<
  AsyncResult<OUTPUT, ERR>
> & {
  useSubscribe(): AsyncResult<OUTPUT, ERR>;
  refresh(): Promise<OUTPUT>;
  unsubscribe(): void;
};

export function shareAsync<OUTPUT, ERR = unknown>(
  factory: AsyncFactory<OUTPUT>,
  finalizeFn: () => void = () => void 0
): SharedAsync<OUTPUT, ERR> {
  const [observable, refresh] = observeAsyncWithRefresh<OUTPUT, ERR>(
    of(factory),
    finalizeFn
  );
  const subject = new BehaviorSubject({ pending: true });
  const sub = observable.subscribe(subject);
  return Object.assign(observable, {
    useSubscribe() {
      return useSubscribe(subject, subject.value);
    },
    refresh() {
      return refresh();
    },
    unsubscribe() {
      sub.unsubscribe();
      subject.complete();
    },
  });
}

export function sharedAsyncFactory<INPUT, OUTPUT, ERR = unknown>({
  factory,
  getKey,
}: {
  factory: (input: INPUT) => AsyncFactory<OUTPUT>;
  getKey: (input: INPUT) => string;
}): (input: INPUT) => SharedAsync<OUTPUT, ERR> {
  const store: {
    [key: string]: SharedAsync<OUTPUT, ERR>;
  } = {};
  const getResource = (input: INPUT) => {
    const key = getKey(input);
    if (!store[key]) {
      const res = shareAsync<OUTPUT, ERR>(
        factory(input),
        () => delete store[key]
      );
      store[key] = res;
    }
    return store[key];
  };
  return getResource;
}

export function useObservedProp<A>(a: A): Observable<A> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subject = useMemo(() => new BehaviorSubject<A>(a), []);
  useEffect(() => {
    if (subject.value !== a) {
      subject.next(a);
    }
  }, [a, subject]);
  useEffect(() => () => subject.complete(), [subject]);
  return useMemo(() => subject.asObservable(), [subject]);
}

export function createSharedFetch<T, INPUT extends unknown[], ERR = unknown>(
  init$: Observable<RequestInit>,
  request: (...input: INPUT) => string,
  selector: (response: Response) => Promise<T>,
  fromFetch: typeof defaultFromFetch = defaultFromFetch
): (...input: INPUT) => SharedAsync<T, ERR> {
  const shared = sharedAsyncFactory<string, T, ERR>({
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
  return (...input: INPUT) => {
    return shared(request(...input));
  };
}

export type SyncState<T> = Observable<T> & {
  dispatch: (action: (v: T) => T | T) => T;
  unsubscribe: () => void;
};

export function syncState<T>(initialValue: T): SyncState<T> {
  const state$ = new BehaviorSubject(initialValue);
  const dispatch = (value: T | ((prev: T) => T)) => {
    const nextValue = value instanceof Function ? value(state$.value) : value;
    if (nextValue !== state$.value) {
      state$.next(nextValue);
    }
    return state$.value;
  };
  return Object.assign(state$.asObservable(), {
    dispatch,
    unsubscribe() {
      state$.complete();
    },
  });
}

function isPromise<T>(obj: any): obj is Promise<T> {
  return obj && typeof obj.then === 'function';
}

function isObservable<T>(obj: any): obj is Observable<T> {
  return obj && typeof obj.subscribe === 'function';
}

export type AsyncState<T> = Observable<T> & {
  dispatch: (action: (v: T) => T | Promise<T> | Observable<T>) => Promise<T>;
  getState: () => T;
  unsubscribe: () => void;
};

export function asyncState<T>(initialValue: T): AsyncState<T> {
  const queue = new Subject<
    [(v: T) => T | Promise<T> | Observable<T>, (r: T) => void]
  >();
  const state$ = new BehaviorSubject<T>(initialValue);
  const sub = queue
    .pipe(
      concatMap(([applicator, resolver]) => {
        const next = applicator(state$.value);
        if (isObservable(next)) {
          let lastValue: T;
          return next.pipe(
            tap(res => (lastValue = res)),
            finalize(() => resolver(lastValue))
          );
        } else if (isPromise(next)) {
          return from(
            next.then(pass => {
              resolver(pass);
              return pass;
            })
          );
        }
        resolver(next);
        return of(next);
      })
    )
    .subscribe(state$);
  return Object.assign(state$.asObservable(), {
    dispatch(action: (v: T) => T | Promise<T> | Observable<T>): Promise<T> {
      return new Promise<T>(resolve => {
        queue.next([action, resolve]);
      });
    },
    getState(): T {
      return state$.value;
    },
    unsubscribe() {
      sub.unsubscribe();
      state$.complete();
    },
  });
}

export type AsyncResultWithExecute<
  INPUT extends unknown[],
  T,
  ERR
> = AsyncResult<T, ERR> & {
  execute: (...inputs: INPUT) => Promise<AsyncResult<T, ERR>>;
};

export function useAsyncCallback<INPUT extends unknown[], T, ERR = unknown>(
  factory: (...input: INPUT) => Promise<T>,
  dependencies: unknown[]
): AsyncResultWithExecute<INPUT, T, ERR> {
  const state$ = useMemo(
    () => asyncState<AsyncResult<T, ERR>>({ pending: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const callback = useCallback(factory, dependencies);
  const monitor = useMemo(() => new Monitor(), []);
  const factories = useObservedProp(callback);
  const execute = useCallback(
    async (...input: INPUT) => {
      state$.dispatch(() => ({ pending: true }));
      const result = await factories
        .pipe(
          take(1),
          switchMap(fn => fn(...input)),
          map(result => ({ pending: false, result })),
          catchError(err => of({ pending: false, error: err as ERR }))
        )
        .toPromise();
      return await state$.dispatch(() => result);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [factories]
  );

  const [output, setOutput] = useState<AsyncResult<T, ERR>>(state$.getState());
  const outputRef = useRef<AsyncResult<T, ERR>>(output);
  outputRef.current = output;
  useEffect(() => {
    const sub = state$.subscribe(item => {
      if (item.pending) {
        if (monitor.usingPending) {
          setOutput(item);
        }
      } else {
        const old = outputRef.current;
        if (
          old.result !== item.result ||
          old.error !== item.error ||
          old.pending !== item.pending
        ) {
          setOutput(item);
        }
      }
    });
    return () => sub.unsubscribe();
  }, [state$, monitor, outputRef]);
  const final = useMemo(
    () =>
      monitor.wrap({
        ...output,
        execute,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monitor, output, execute]
  );
  if (!monitor.usingError) {
    if (output.error !== undefined) {
      throw output.error;
    }
  }
  return final;
}
