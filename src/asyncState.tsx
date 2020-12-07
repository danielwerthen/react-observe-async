import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { BehaviorSubject, from, isObservable, Subject } from 'rxjs';
import {
  concatMap,
  distinctUntilChanged,
  finalize,
  map,
  tap,
} from 'rxjs/operators';
import {
  AsyncReducer,
  AsyncState,
  AsyncAction,
  AsyncStateContext,
} from './types';
import { useInitialize, useSubscribe } from './utils';

/**
 * `asyncState` allows you to share redux-like state without the boilerplate. It utilies a queue to ensure that any dispatched action
 * is reflect in the shared state in a sequential way. If two actions are dispatched at the same time, the first one will be exhausted before the next action is updating the state.
 * The dispatch function returns a promise resolves once the entire dispatched action has been exhausted.
 * An action can be a single state value, or a function that returns a single, promise or observable of state values.
 * @param initialValue
 * @param reducer
 */
export function observeAsyncState<STATE, ACTION = STATE>(
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
    useSelect<OUTPUT>(
      selector: (state: STATE) => OUTPUT,
      deps: unknown[]
    ): OUTPUT {
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

export const shareAsyncState = observeAsyncState;

export function useAsyncState<STATE, ACTION = STATE>(
  initialValue: STATE,
  reducer: AsyncReducer<STATE, ACTION>,
  deps: unknown[]
) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state$ = useMemo(() => observeAsyncState(initialValue, reducer), [
    reducer,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ...deps,
  ]);
  const state = state$.useSubscribe();
  return [state, state$.dispatch];
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
