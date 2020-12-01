import {
  from,
  Observable,
  ObservableInput,
  OperatorFunction,
  Subject,
} from 'rxjs';
import { exhaustMap, finalize, throttle } from 'rxjs/operators';

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
