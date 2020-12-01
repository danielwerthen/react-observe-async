import {
  catchError,
  concatMap,
  finalize,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { BehaviorSubject, from, Observable, of, Subject } from 'rxjs';
import { fromFetch as defaultFromFetch } from 'rxjs/fetch';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AsyncFactory, AsyncResult } from './types';
import { observeAsync } from './observeAsync';

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

export function useAsync<T, ERR>(
  factory: AsyncFactory<T>,
  dependencies: unknown[]
): AsyncResult<T, ERR> {
  const callback = useCallback(factory, dependencies);
  const monitor = useMemo(() => new Monitor(), []);
  const factories = useObservedProp(callback);
  const observable = useMemo(() => {
    return observeAsync<T, ERR>(factories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);
  const [output, setOutput] = useState<AsyncResult<T, ERR>>(observable.value);
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
  refresh(): Promise<AsyncResult<OUTPUT, ERR>>;
  unsubscribe(): void;
};

export function shareAsync<OUTPUT, ERR = unknown>(
  factory: AsyncFactory<OUTPUT>
): SharedAsync<OUTPUT, ERR> {
  const observable = observeAsync<OUTPUT, ERR>(of(factory));
  return Object.assign(observable, {
    useSubscribe() {
      return useSubscribe(observable, observable.value);
    },
    refresh() {
      return observable.value.refresh();
    },
    unsubscribe() {
      observable.complete();
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
      const res = shareAsync<OUTPUT, ERR>(factory(input));
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

export type AsyncResultWithExecute<INPUT extends unknown[], T, ERR> = Omit<
  AsyncResult<T, ERR>,
  'refresh'
> & {
  execute: (...inputs: INPUT) => Promise<Omit<AsyncResult<T, ERR>, 'refresh'>>;
};

export function useAsyncCallback<INPUT extends unknown[], T, ERR = unknown>(
  factory: (...input: INPUT) => Promise<T>,
  dependencies: unknown[]
): AsyncResultWithExecute<INPUT, T, ERR> {
  const state$ = useMemo(
    () =>
      asyncState<Omit<AsyncResult<T, ERR>, 'refresh'>>({
        pending: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const callback = useCallback(factory, dependencies);
  const monitor = useMemo(() => new Monitor(), []);
  const factories = useObservedProp(callback);
  const execute = useCallback(
    async (...input: INPUT) => {
      state$.dispatch(() => ({
        pending: true,
      }));
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

  const [output, setOutput] = useState<Omit<AsyncResult<T, ERR>, 'refresh'>>(
    state$.getState()
  );
  const outputRef = useRef<Omit<AsyncResult<T, ERR>, 'refresh'>>(output);
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
  return { ...output, execute };
}
