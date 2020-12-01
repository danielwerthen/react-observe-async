import {
  BehaviorSubject,
  combineLatest,
  from,
  Observable,
  of,
  ReplaySubject,
  Subject,
  Subscription,
} from 'rxjs';
import {
  catchError,
  debounceTime,
  finalize,
  map,
  skip,
  startWith,
  take,
  tap,
} from 'rxjs/operators';
import { exhaustMapWithTrailing } from './exhaustMapWithTrailing';
import { AsyncFactory } from './types';

export type AsyncResult<T, ERR> = {
  pending: boolean;
  result?: T;
  error?: ERR;
  refresh: () => Promise<AsyncResult<T, ERR>>;
};

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
      return from(promise).pipe(
        tap(() => {
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
      if (subscription) {
        subscription.unsubscribe();
      }
    })
  );
  subscription = obs.subscribe(subj);
  return subj;
}
