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

export type AsyncFactory<T> = (
  observe: ObserveValue
) => Promise<T> | Observable<T> | Promise<Observable<T>>;

export type SharedAsync<OUTPUT, ERR = unknown> = Observable<
  AsyncResult<OUTPUT, ERR>
> & {
  useSubscribe(): AsyncResult<OUTPUT, ERR>;
  refresh(): Promise<AsyncResult<OUTPUT, ERR>>;
};

export type AsyncState<T, ACTION> = Observable<T> & {
  dispatch: (action: AsyncAction<T, ACTION>) => Promise<T>;
  getValue: () => T;
  useSubscribe: () => T;
  useSelect: <O>(selector: (t: T) => O, deps: unknown[]) => O;
  unsubscribe: () => void;
};

export type AsyncReducer<STATE, ACTION> = (
  state: STATE,
  action: ACTION
) => STATE | Promise<STATE> | Observable<STATE>;

export type AsyncAction<STATE, ACTION = STATE> =
  | ACTION
  | ((v: STATE) => ACTION | Promise<ACTION> | Observable<ACTION>);

export type AsyncStateContext<STATE, ACTION> = {
  Provider: React.FC<{ initialState?: STATE }>;
  useSubscribe: () => STATE;
  useSelect: <O>(selector: (state: STATE) => O, deps: unknown[]) => O;
  useDispatch: () => (action: AsyncAction<STATE, ACTION>) => Promise<STATE>;
};
