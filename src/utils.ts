import {
  BehaviorSubject,
  from,
  Observable,
  ObservableInput,
  OperatorFunction,
  Subject,
} from 'rxjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AsyncBase } from './types';
import { exhaustMap, finalize, throttle } from 'rxjs/operators';

export class Monitor {
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

/**
 * This hook turns a series of prop values into a referentially stable observable.
 * @param a a prop
 */
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

export function isObservable<T>(obj: any): obj is Observable<T> {
  return obj && typeof obj.subscribe === 'function';
}

export function useInitialize<T>(factory: () => T): T {
  const ref = useRef<T>();
  if (!ref.current) {
    ref.current = factory();
  }
  return ref.current;
}

/**
 * Credit to: https://github.com/ReactiveX/rxjs/issues/5004
 * @param project
 */
export function exhaustMapWithTrailing<T, R>(
  project: (value: T, index: number) => ObservableInput<R>
): OperatorFunction<T, R> {
  return (source): Observable<R> => {
    const release = new Subject();

    return source.pipe(
      throttle(() => release, {
        leading: true,
        trailing: true,
      }),
      // TODO: Upgrade to TypeScript 3.6.3 when available and remove the cast
      // https://github.com/microsoft/TypeScript/issues/33131
      exhaustMap((value, index) =>
        from(project(value, index)).pipe(
          finalize(() => {
            release.next();
          })
        )
      ) as OperatorFunction<T, R>
    );
  };
}
