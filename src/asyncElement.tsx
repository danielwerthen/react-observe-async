import React, {
  DependencyList,
  ReactElement,
  ReactNode,
  useCallback,
  useMemo,
} from 'react';
import { observeAsync } from './async';
import { AsyncFactory } from './types';
import { useAsyncBase } from './useAsyncBase';
import { useObservedProp } from './utils';

export function useAsyncElement<T extends ReactElement<any, any> | null, ERR>(
  factory: AsyncFactory<T>,
  dependencies: DependencyList
): ReactNode {
  const callback = useCallback(factory, dependencies);
  const factories = useObservedProp(callback);
  const subject = useMemo(() => {
    return observeAsync<T, ERR>(factories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);
  const Comp = useCallback(() => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { result } = useAsyncBase(subject, subject.value);
    return result || null;
  }, [subject]);

  return <Comp />;
}
