import {
  catchError,
  concatMap,
  distinctUntilChanged,
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
import React, {
  createContext,
  DependencyList,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AsyncFactory,
  AsyncResult,
  AsyncBase,
  AsyncCallback,
  SharedAsync,
  AsyncStateContext,
  AsyncState,
  AsyncAction,
  AsyncReducer,
} from './types';
import { observeAsync } from './observeAsync';
import { Monitor, useObservedProp, useSubscribe, isObservable } from './utils';

export function useAsyncBase<S extends AsyncBase<unknown, unknown>>(
  result$: Observable<S>,
  initialValue: S
): S {
  const monitor = useMemo(() => new Monitor(), []);
  const [output, setOutput] = useState<S>(initialValue);
  const outputRef = useRef<S>(output);
  const setPending = useSetPending();
  outputRef.current = output;
  useEffect(() => {
    const sub = result$.subscribe(item => {
      if (item.pending) {
        setPending(true);
        if (monitor.usingPending) {
          setOutput(item);
        }
      } else {
        setPending(false);
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
  }, [result$, monitor, outputRef, setPending]);
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
      return useSubscribe(obs, { pending: true, refresh });
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

/**
 * `asyncState` allows you to share redux-like state without the boilerplate. It utilies a queue to ensure that any dispatched action
 * is reflect in the shared state in a sequential way. If two actions are dispatched at the same time, the first one will be exhausted before the next action is updating the state.
 * The dispatch function returns a promise resolves once the entire dispatched action has been exhausted.
 * An action can be a single state value, or a function that returns a single, promise or observable of state values.
 * @param initialValue
 * @param reducer
 */
export function asyncState<STATE, ACTION = STATE>(
  initialValue: STATE,
  reducer: AsyncReducer<STATE, ACTION>
): AsyncState<STATE, ACTION> {
  const queue = new Subject<[AsyncAction<STATE, ACTION>, (r: STATE) => void]>();
  const state$ = new BehaviorSubject<STATE>(initialValue);
  const sub = queue
    .pipe(
      concatMap(([applicator, resolver]) => {
        const action =
          applicator instanceof Function
            ? applicator(state$.value)
            : applicator;
        let lastValue: STATE;
        const observableAction = isObservable(action)
          ? action
          : from(Promise.resolve(action));
        return observableAction.pipe(
          concatMap(action => {
            const next = reducer(state$.value, action);
            return isObservable(next) ? next : Promise.resolve(next);
          }),
          tap(res => (lastValue = res)),
          finalize(() => resolver(lastValue))
        );
      })
    )
    .subscribe(state$);
  return Object.assign(state$.asObservable(), {
    dispatch(action: AsyncAction<STATE, ACTION>): Promise<STATE> {
      return new Promise<STATE>(resolve => {
        queue.next([action, resolve]);
      });
    },
    getValue(): STATE {
      return state$.value;
    },
    useSubscribe(): STATE {
      return useSubscribe(state$, state$.value);
    },
    useSelect<O>(selector: (state: STATE) => O, deps: unknown[]): O {
      const callback = useCallback(selector, deps);
      const selected = useMemo(
        () => state$.pipe(map(callback), distinctUntilChanged()),
        [callback]
      );
      const initial = useInitialize(() => selector(state$.value));
      return useSubscribe(selected, initial);
    },
    unsubscribe() {
      sub.unsubscribe();
      state$.complete();
      queue.unsubscribe();
    },
  });
}

export function observeAsyncCallback<INPUT extends unknown[], T, ERR = unknown>(
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
  const state$ = asyncState<AsyncCallback<INPUT, T, ERR>>(
    {
      pending: false,
      execute,
    },
    (_state, action) => action
  );
  return state$;
}

export function shareAsyncCallback<INPUT extends unknown[], T, ERR = unknown>(
  factory: (...input: INPUT) => Promise<T>
) {
  const state$ = observeAsyncCallback<INPUT, T, ERR>(of(factory));
  return Object.assign(state$, {
    execute(...input: INPUT) {
      return state$
        .pipe(
          take(1),
          switchMap(item => item.execute(...input))
        )
        .toPromise();
    },
    useSubscribe() {
      return useAsyncBase(state$, state$.getValue());
    },
    useSelect<O>(
      selector: (state: AsyncCallback<INPUT, T, ERR>) => O,
      deps: unknown[]
    ) {
      return state$.useSelect(selector, deps);
    },
    getValue() {
      return state$.getValue();
    },
    unsubscribe() {
      return state$.unsubscribe();
    },
  });
}

/**
 * Use this instead of `useAsync` if you want to control the timing of the asynchronous operations. Operations will be executed in an enforced sequence, using an underlying `asyncState`.
 * @param factory
 * @param dependencies
 */
export function useAsyncCallback<INPUT extends unknown[], T, ERR = unknown>(
  factory: (...input: INPUT) => Promise<T>,
  dependencies: unknown[]
): AsyncCallback<INPUT, T, ERR> {
  const callback = useCallback(factory, dependencies);
  const factories = useObservedProp(callback);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state$ = useMemo(() => observeAsyncCallback<INPUT, T, ERR>(factories), [
    factories,
  ]);
  return useAsyncBase(state$, state$.getValue());
}

function useInitialize<T>(factory: () => T): T {
  const ref = useRef<T>();
  if (!ref.current) {
    ref.current = factory();
  }
  return ref.current;
}

/**
 * Sometime you want encapsulate the `asyncState` in a context, to allow for concurrent async states across an application.
 * @param stateFactory
 */
export function asyncStateContext<STATE, ACTION>(
  stateFactory: (initial?: STATE) => AsyncState<STATE, ACTION>
): AsyncStateContext<STATE, ACTION> {
  const context = createContext(stateFactory());
  const Provider: React.FC<{ initialState?: STATE }> = ({
    children,
    initialState,
  }) => {
    const ctx = useInitialize(() => stateFactory(initialState));
    useEffect(() => () => ctx.unsubscribe(), [ctx]);
    return <context.Provider value={ctx}>{children}</context.Provider>;
  };
  return {
    Provider,
    useSubscribe: () => {
      const state = useContext(context);
      return state.useSubscribe();
    },
    useSelect<OUTPUT>(
      selector: (state: STATE) => OUTPUT,
      deps: unknown[]
    ): OUTPUT {
      const state = useContext(context);
      return state.useSelect(selector, deps);
    },
    useDispatch: () => {
      const state = useContext(context);
      const dispatchRef = useRef(state.dispatch);
      dispatchRef.current = state.dispatch;
      return useCallback((...args) => dispatchRef.current(...args), [
        dispatchRef,
      ]);
    },
  };
}

const pendingState = asyncStateContext(() => {
  return asyncState<Set<Symbol>, [Symbol, boolean]>(
    new Set<Symbol>(),
    (state, [sym, pending]) => {
      if (pending) {
        state.add(sym);
      } else {
        state.delete(sym);
      }
      return state;
    }
  );
});

/**
 * This will reflect the pending state of any `useAsync` or `useAsyncCallback` operations, inside the pending boundary context.
 */
export function usePending() {
  return pendingState.useSelect(symbols => symbols.size > 0, []);
}

/**
 * Use this callback if you want to use the pending context outside of the `useAsync` and `useAsyncCallback` hooks.
 */
export function useSetPending() {
  const sym = useInitialize(() => Symbol('Pending state identifier'));
  const dispatch = pendingState.useDispatch();
  return useCallback(
    (pending: boolean) => {
      return dispatch([sym, pending]);
    },
    [dispatch, sym]
  );
}

export const PendingBoundary: React.FC<{}> = ({ children }) => (
  <pendingState.Provider>{children}</pendingState.Provider>
);
