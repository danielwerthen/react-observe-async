import { map } from 'rxjs/operators';
import { asyncState } from '../src';

export const authToken = asyncState<string | undefined>(undefined);
export const init = authToken.pipe(
  map(auth => ({
    headers: {
      Auth: 'bearer ' + auth,
    },
  }))
);
