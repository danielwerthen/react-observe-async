import React, {
  createContext,
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BehaviorSubject,
  combineLatest,
  ConnectableObservable,
  from,
  Observable,
  ObservableInput,
  of,
  OperatorFunction,
  ReplaySubject,
  Subject,
  Subscription,
} from 'rxjs';
import {
  catchError,
  exhaustMap,
  finalize,
  map,
  publishReplay,
  refCount,
  startWith,
  take,
  tap,
  throttle,
} from 'rxjs/operators';

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

type HashStore<T> = { [key: string]: T };

export type RefreshFunction<T> = () => Promise<AsyncResponseBody<T>>;
export type AsyncFactory<T> = () => Promise<T>;
export type AsyncResponseBody<T> = {
  response?: T;
  error?: unknown;
  refresh: RefreshFunction<T>;
};

export type AsyncResponse<T> = Observable<AsyncResponseBody<T>>;

export function observeAsyncFactory<T>(
  factory: AsyncFactory<T>
): AsyncResponse<T> {
  const refresh$ = new Subject();
  const continuation$ = new Subject<AsyncResponseBody<T>>();

  const refresh = () => {
    const promise = continuation$.pipe(take(1)).toPromise();
    refresh$.next();
    return promise;
  };

  return refresh$.pipe(
    startWith(0),
    exhaustMapWithTrailing(factory),
    map(response => ({ response, error: undefined })),
    catchError(error =>
      of({
        error,
        response: undefined,
      })
    ),
    map(({ response, error }) => ({ response, error, refresh })),
    tap(result => continuation$.next(result))
  );
}

export type CacheFn = {
  <T>(factory: AsyncFactory<T>, key: string): AsyncResponse<T>;
  refresh: (...cacheKeys: string[]) => Promise<unknown[]>;
};

export type SessionCacheFn = CacheFn & {
  beginSession(): void;
  endSession(): void;
};

function isSessionCacheFn(obj: any): obj is SessionCacheFn {
  return (
    typeof obj.beginSession === 'function' &&
    typeof obj.endSession === 'function'
  );
}

export type CachedPromiseFn = {
  <T>(factory: AsyncFactory<T>, key: string): Promise<T>;
  refresh: (...cacheKeys: string[]) => Promise<unknown[]>;
};

export type FactoryWithCache<T> = (cache: CachedPromiseFn) => Promise<T>;

export function observeCachedFactory<T>(
  factory$: ObservableInput<FactoryWithCache<T>>,
  cache: CacheFn | SessionCacheFn
): AsyncResponse<T> {
  const subscriptions: Subscription[] = [];
  const refresh = new BehaviorSubject(null);
  const continuation = new Subject<AsyncResponseBody<T>>();
  const clearSubs = () => {
    subscriptions.forEach(sub => sub.unsubscribe());
    subscriptions.splice(0, subscriptions.length);
  };
  return combineLatest([from(factory$), refresh]).pipe(
    map(res => res[0]),
    exhaustMapWithTrailing(async (factory: FactoryWithCache<T>) => {
      clearSubs();
      const refreshArray: RefreshFunction<unknown>[] = [];
      if (isSessionCacheFn(cache)) {
        cache.beginSession();
      }
      const response = await factory(
        Object.assign(
          function inner<S>(innerFactory: AsyncFactory<S>, cacheKey: string) {
            const observable = cache<S>(innerFactory, cacheKey);
            const responseSubject = new Subject<S>();
            const returnValue = responseSubject.toPromise();
            subscriptions.push(
              observable.subscribe(res => {
                if (!responseSubject.isStopped) {
                  refreshArray.push(res.refresh);
                  if (res.response) {
                    responseSubject.next(res.response);
                    responseSubject.complete();
                  } else if (res.error) {
                    responseSubject.error(res.error);
                  }
                } else {
                  refresh.next(null);
                }
              })
            );
            return returnValue;
          },
          { refresh: (...args: string[]) => cache.refresh(...args) }
        )
      );
      if (isSessionCacheFn(cache)) {
        cache.endSession();
      }
      return {
        response,
        refresh: async () => {
          await Promise.all(refreshArray.map(r => r()));
          refresh.next(null);
          return continuation.pipe(take(1)).toPromise();
        },
      };
    }),
    tap(item => continuation.next(item)),
    finalize(() => clearSubs())
  );
}

function createDefaultContext() {
  const store: HashStore<AsyncResponse<unknown>> = {};
  const cache: CacheFn = Object.assign(
    function cache<T>(factory: AsyncFactory<T>, key: string): AsyncResponse<T> {
      if (!store[key]) {
        store[key] = observeAsyncFactory(factory).pipe(
          finalize(() => {
            delete store[key];
          }),
          publishReplay(1),
          refCount()
        );
      }
      return store[key] as AsyncResponse<T>;
    },
    {
      refresh(...cacheKeys: string[]) {
        return Promise.all(
          cacheKeys
            .filter(cacheKey => store[cacheKey])
            .map(cacheKey =>
              store[cacheKey]
                .pipe(take(1))
                .toPromise()
                .then(item => item.refresh())
            )
        );
      },
    }
  );
  return {
    cache,
  };
}

export type CompositeAsyncFactory<T> = (cache: CachedPromiseFn) => Promise<T>;

const cacheContext = createContext<{ cache: CacheFn }>(createDefaultContext());

export const CacheProvider: FC<{}> = ({ children }) => {
  const ctx = useMemo(() => createDefaultContext(), []);
  return <cacheContext.Provider value={ctx}>{children}</cacheContext.Provider>;
};

export function useAsyncCache(): SessionCacheFn {
  const store = useMemo<
    HashStore<{
      observable: ConnectableObservable<AsyncResponseBody<unknown>>;
      subscription: Subscription;
    }>
  >(() => ({}), []);
  const { cache } = useContext(cacheContext);
  const callback = useMemo<SessionCacheFn>(() => {
    const keySet = new Set<string>();
    const fn: SessionCacheFn = Object.assign(
      ((factory: AsyncFactory<unknown>, cacheKey: string) => {
        keySet.add(cacheKey);
        if (!store[cacheKey]) {
          const observable = cache(factory, cacheKey).pipe(
            publishReplay(1)
          ) as ConnectableObservable<AsyncResponseBody<unknown>>;
          store[cacheKey] = {
            observable,
            subscription: observable.connect(),
          };
          observable.connect();
        }
        return store[cacheKey].observable as AsyncResponse<unknown>;
      }) as CacheFn,
      {
        refresh(...cacheKeys: string[]) {
          return cache.refresh(...cacheKeys);
        },
        beginSession() {
          keySet.clear();
        },
        endSession() {
          Object.keys(store)
            .filter(key => !keySet.has(key))
            .forEach(cacheKey => {
              const item = store[cacheKey];
              item.subscription.unsubscribe();
              delete store[cacheKey];
            });
        },
      }
    );
    return fn;
  }, [cache, store]);
  useEffect(() => {
    return () => {
      Object.keys(store).forEach(cacheKey => {
        const item = store[cacheKey];
        item.subscription.unsubscribe();
        delete store[cacheKey];
      });
    };
  }, [store]);
  return callback;
}

export type AsyncState<T> = AsyncResponseBody<T> & {
  pending: boolean;
};

export function useAsync<T>(
  factory: FactoryWithCache<T>,
  dependencies: unknown[]
): AsyncState<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const factories = useMemo(() => new BehaviorSubject(factory), []);
  useEffect(() => {
    if (factories.value !== factory) {
      factories.next(factory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories, ...dependencies]);
  const cache = useAsyncCache();
  const observable = useMemo(() => {
    return observeCachedFactory(factories.asObservable(), cache);
  }, [factories, cache]);
  const [state, setState] = useState<AsyncResponseBody<T>>();
  const initialSubject = useMemo(
    () => new ReplaySubject<AsyncResponseBody<T>>(1),
    []
  );
  useEffect(() => {
    const sub = observable
      .pipe(
        tap(response => {
          if (initialSubject.isStopped) {
            return;
          }
          initialSubject.next(response);
          initialSubject.complete();
        })
      )
      .subscribe(setState);
    return () => sub.unsubscribe();
  }, [observable, initialSubject]);
  const refreshRef = useRef<RefreshFunction<T>>(() =>
    initialSubject.toPromise()
  );
  if (state?.refresh) {
    refreshRef.current = state.refresh;
  }
  const refresh = useCallback(() => {
    return refreshRef.current();
  }, [refreshRef]);
  return {
    pending: state === undefined,
    ...state,
    refresh,
  };
}
