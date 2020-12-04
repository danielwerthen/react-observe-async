import React, { useCallback } from 'react';
import { asyncState, asyncStateContext } from './asyncState';
import { useInitialize } from './utils';

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
