import {
  catchError,
  concatMap,
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
import { BehaviorSubject, from, Observable, of, Subject } from 'rxjs';
import { fromFetch as defaultFromFetch } from 'rxjs/fetch';
import {
  DependencyList,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AsyncFactory, AsyncResult, AsyncBase, AsyncCallback } from './types';
import { observeAsync } from './observeAsync';

class Monitor {
  usingPending = false;
  usingError = false;

  wrap<AR extends AsyncBase<unknown, unknown>>(result: AR): AR {
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

export function useSubscribe<T>(observable: Observable<T>, initialValue: T): T {
  const [state, setState] = useState(initialValue);
  useEffect(() => {
    const sub = observable.subscribe(setState);
    return () => sub.unsubscribe();
  }, [observable]);
  return state;
}

export function useAsyncBase<S extends AsyncBase<unknown, unknown>>(
  result$: Observable<S>,
  initialValue: S
): S {
  const monitor = useMemo(() => new Monitor(), []);
  const [output, setOutput] = useState<S>(initialValue);
  const outputRef = useRef<S>(output);
  outputRef.current = output;
  useEffect(() => {
    const sub = result$.subscribe(item => {
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
  }, [result$, monitor, outputRef]);
  const final = useMemo(
    () => monitor.wrap(output),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monitor, output]
  );
  if (!monitor.usingError) {
    if (output.error !== undefined) {
      throw output.error;
    }
  }
  return final;
}

/**
 * `useAsync` will only recompute the async result when one of the `dependencies` has changed.
 * The factory function gets an observe function as its first parameter. This function can turn an
 * observable into a promise, and update the async result once the observable emits a new value.
 * @param factory
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

export type SharedAsync<OUTPUT, ERR = unknown> = Observable<
  AsyncResult<OUTPUT, ERR>
> & {
  useSubscribe(): AsyncResult<OUTPUT, ERR>;
  refresh(): Promise<AsyncResult<OUTPUT, ERR>>;
};

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
      return useSubscribe(obs, { pending: true, refresh });
    },
    refresh,
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
      const res = shareAsync<OUTPUT, ERR>(factory(input), () => {
        delete store[key];
      });
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

function isPromise<T>(obj: any): obj is Promise<T> {
  return obj && typeof obj.then === 'function';
}

function isObservable<T>(obj: any): obj is Observable<T> {
  return obj && typeof obj.subscribe === 'function';
}

export type AsyncState<T> = Observable<T> & {
  dispatch: (
    action: T | ((v: T) => T | Promise<T> | Observable<T>)
  ) => Promise<T>;
  getValue: () => T;
  useSubscribe: () => T;
  unsubscribe: () => void;
};

export function asyncState<T>(initialValue: T): AsyncState<T> {
  const queue = new Subject<
    [T | ((v: T) => T | Promise<T> | Observable<T>), (r: T) => void]
  >();
  const state$ = new BehaviorSubject<T>(initialValue);
  const sub = queue
    .pipe(
      concatMap(([applicator, resolver]) => {
        if (applicator instanceof Function) {
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
        }
        resolver(applicator);
        return of(applicator);
      })
    )
    .subscribe(state$);
  return Object.assign(state$.asObservable(), {
    dispatch(
      action: T | ((v: T) => T | Promise<T> | Observable<T>)
    ): Promise<T> {
      return new Promise<T>(resolve => {
        queue.next([action, resolve]);
      });
    },
    getValue(): T {
      return state$.value;
    },
    useSubscribe(): T {
      return useSubscribe(state$, state$.value);
    },
    unsubscribe() {
      sub.unsubscribe();
      state$.complete();
    },
  });
}

export function asyncCallback<INPUT extends unknown[], T, ERR = unknown>(
  factories: Observable<(...input: INPUT) => Promise<T>>
) {
  const execute: (
    ...inputs: INPUT
  ) => Promise<AsyncCallback<INPUT, T, ERR>> = async (...input: INPUT) => {
    return await state$.dispatch(() => {
      return factories.pipe(
        take(1),
        switchMap(fn => fn(...input)),
        map(result => ({ pending: false, result, execute })),
        catchError(err => of({ pending: false, error: err as ERR, execute })),
        startWith({
          pending: true,
          execute,
        })
      );
    });
  };
  const state$ = asyncState<AsyncCallback<INPUT, T, ERR>>({
    pending: false,
    execute,
  });
  return state$;
}

export function useAsyncCallback<INPUT extends unknown[], T, ERR = unknown>(
  factory: (...input: INPUT) => Promise<T>,
  dependencies: unknown[]
): AsyncCallback<INPUT, T, ERR> {
  const callback = useCallback(factory, dependencies);
  const factories = useObservedProp(callback);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state$ = useMemo(() => asyncCallback<INPUT, T, ERR>(factories), [
    factories,
  ]);
  return useAsyncBase(state$, state$.getValue());
}
