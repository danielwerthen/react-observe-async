import { Observable } from 'rxjs';

export interface AsyncBase<T, ERR> {
  pending: boolean;
  result?: T;
  error?: ERR;
}

export interface AsyncResult<T, ERR> extends AsyncBase<T, ERR> {
  refresh: () => Promise<AsyncResult<T, ERR>>;
}

export interface AsyncCallback<INPUT extends unknown[], T, ERR>
  extends AsyncBase<T, ERR> {
  execute: (...input: INPUT) => Promise<AsyncCallback<INPUT, T, ERR>>;
}

export type ObserveValue = <T>(input: Observable<T>) => Promise<T>;

export type AsyncFactory<T> = (observe: ObserveValue) => Promise<T>;
