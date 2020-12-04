import { useEffect, useMemo, useRef, useState } from 'react';
import { Observable } from 'rxjs';
import { useSetPending } from './pending';
import { AsyncBase } from './types';
import { Monitor } from './utils';

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
