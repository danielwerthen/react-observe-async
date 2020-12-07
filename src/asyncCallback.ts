import { useCallback, useMemo } from 'react';
import { Observable, of } from 'rxjs';
import { catchError, map, startWith, switchMap, take } from 'rxjs/operators';
import { observeAsyncState } from './asyncState';
import { AsyncCallback } from './types';
import { useAsyncBase } from './useAsyncBase';
import { useObservedProp } from './utils';

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
  const state$ = observeAsyncState<AsyncCallback<INPUT, T, ERR>>(
    {
      pending: false,
      execute,
    },
    (_state, action) => action
  );
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
  });
}

export function shareAsyncCallback<INPUT extends unknown[], T, ERR = unknown>(
  factory: (...input: INPUT) => Promise<T>
) {
  return observeAsyncCallback<INPUT, T, ERR>(of(factory));
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
