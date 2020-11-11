import { of } from 'rxjs';
import { toArray } from 'rxjs/operators';
import observeAsync from '../src/index';

describe('Thing', () => {
  it('renders without crashing', async () => {
    const observable = observeAsync(
      of(async () => {
        return 5;
      })
    );
    const result = await observable.pipe(toArray()).toPromise();
    console.log(result);
  });
});
