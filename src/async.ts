import {
  BehaviorSubject,
  combineLatest,
  from,
  isObservable,
  Observable,
  of,
  ReplaySubject,
  Subject,
  Subscription,
} from 'rxjs';
import {
  catchError,
  concatMap,
  debounceTime,
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
import { exhaustMapWithTrailing, useObservedProp } from './utils';
import { AsyncFactory, AsyncResult, SharedAsync } from './types';
import { DependencyList, useCallback, useMemo } from 'react';
import { useAsyncBase } from './useAsyncBase';

export function observeAsync<T, ERR = unknown>(
  factories: Observable<AsyncFactory<T>>,
  refreshSubject: Subject<unknown> = new Subject()
): BehaviorSubject<AsyncResult<T, ERR>> {
  const subj: BehaviorSubject<AsyncResult<T, ERR>> = new BehaviorSubject<
    AsyncResult<T, ERR>
  >({
    pending: true,
    refresh: () => {
      refreshSubject.next(0);
      return subj.pipe(skip(1), take(1)).toPromise();
    },
  });
  const obsMap = new WeakMap<Observable<unknown>, ReplaySubject<unknown>>();
  const subMap = new WeakMap<Observable<unknown>, Subscription>();
  const resolveDependant = <T>(observable: Observable<T>): Promise<T> => {
    if (!obsMap.has(observable)) {
      const published = new ReplaySubject(1);
      obsMap.set(observable, published);
      subMap.set(
        observable,
        observable
          .pipe(
            map((item, idx) => {
              if (idx !== 0) {
                refreshSubject.next(0);
              }
              return item;
            })
          )
          .subscribe(published)
      );
    }
    return (obsMap.get(observable) as Observable<T>).pipe(take(1)).toPromise();
  };
  const unsubscribeDependent = (observable: Observable<unknown>) => {
    const obs = obsMap.get(observable);
    const sub = subMap.get(observable);
    if (obs) {
      obsMap.delete(observable);
    }
    if (sub) {
      sub.unsubscribe();
      subMap.delete(observable);
    }
  };
  let prevDependants: Observable<unknown>[] = [];
  let subscription: Subscription;
  const obs = combineLatest([
    factories,
    refreshSubject.pipe(debounceTime(0), startWith(0)),
  ]).pipe(
    exhaustMapWithTrailing(([factory], index) => {
      const dependants: Observable<unknown>[] = [];
      const promise = factory(observable => {
        const obs = resolveDependant(observable);
        dependants.push(observable);
        return obs;
      });
      return (isObservable(promise)
        ? promise
        : from(promise).pipe(
            concatMap(result => {
              if (isObservable(result)) {
                return result;
              }
              return of(result);
            })
          )
      ).pipe(
        finalize(() => {
          prevDependants.forEach(dep => {
            if (!dependants.includes(dep)) {
              unsubscribeDependent(dep);
            }
          });
          prevDependants = dependants;
        }),
        map(result => ({
          pending: false,
          result,
          refresh: subj.value.refresh,
        })),
        catchError(error =>
          of({
            pending: false,
            error: error as ERR,
            refresh: subj.value.refresh,
          })
        ),
        index > 0
          ? startWith({
              pending: true,
              result: subj.value.result,
              refresh: subj.value.refresh,
            })
          : tap(() => void 0)
      );
    }),
    finalize(() => {
      prevDependants.forEach(dep => {
        unsubscribeDependent(dep);
      });
      if (subscription) {
        subscription.unsubscribe();
        refreshSubject.complete();
      }
    })
  );
  subscription = obs.subscribe(subj);
  const oldComplete = subj.complete;
  return Object.assign(subj, {
    complete() {
      oldComplete.apply(subj);
      subscription.unsubscribe();
    },
  });
}

/**
 * `useAsync` will only recompute the async result when one of the `dependencies` has changed.
 * The factory function gets an observe function as its first parameter. This function can turn an
 * observable into a promise, and update the async result once the observable emits a new value.
 * @param factory Async factory method which will be provided with the observe function.
 * @param dependencies
 */
export function useAsync<T, ERR>(
  factory: AsyncFactory<T>,
  dependencies: DependencyList
): AsyncResult<T, ERR> {
  const callback = useCallback(factory, dependencies);
  const factories = useObservedProp(callback);
  const subject = useMemo(() => {
    return observeAsync<T, ERR>(factories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);
  return useAsyncBase(subject, subject.value);
}

/**
 * Compared to `useAsync`, this will allow the resulting value be shared by any components.
 * The resulting observable is published and refcounted to ensure the same async result is shared between subscribers.
 * The factory will be trigged when the observable is resubscribed after a period of no subscriptions.
 * @param factory Async factory method which will be provided with the observe function.
 * @param finalizeFn The resulting observable will call this callback whenever there is no subscriptions ongoing.
 */
export function shareAsync<OUTPUT, ERR = unknown>(
  factory: AsyncFactory<OUTPUT>,
  finalizeFn: () => void = () => void 0
): SharedAsync<OUTPUT, ERR> {
  const obs = of(0).pipe(
    switchMap(() => {
      return observeAsync<OUTPUT, ERR>(of(factory));
    }),
    skip(1),
    finalize(finalizeFn),
    publishReplay(1),
    refCount()
  );
  const refresh = () => {
    return obs
      .pipe(take(1))
      .toPromise()
      .then(item => item.refresh());
  };
  return Object.assign(obs.pipe(startWith({ pending: true, refresh })), {
    useSubscribe() {
      return useAsyncBase(obs, { pending: true, refresh });
    },
    refresh,
  });
}

/**
 * Sometimes you want to share a set of similar async observables, cached by a `string`. Otherwise same as `shareAsync`.
 * @param options
 */
export function sharedAsyncMap<INPUT, OUTPUT, ERR = unknown>(
  factory: (input: INPUT) => AsyncFactory<OUTPUT>,
  getKey: (input: INPUT) => string
): (input: INPUT) => SharedAsync<OUTPUT, ERR> {
  const store: {
    [key: string]: SharedAsync<OUTPUT, ERR>;
  } = {};
  const getResource = (input: INPUT) => {
    const key = getKey(input);
    if (!store[key]) {
      const res = shareAsync<OUTPUT, ERR>(factory(input), () => {
        delete store[key];
      });
      store[key] = res;
    }
    return store[key];
  };
  return getResource;
}
