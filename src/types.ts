import { Observable } from 'rxjs';

export type AsyncResult<T, ERR> = {
  pending: boolean;
  result?: T;
  error?: ERR;
};

export type ObserveValue = <T>(input: Observable<T>) => Promise<T>;

export type AsyncFactory<T> = (observe: ObserveValue) => Promise<T>;
