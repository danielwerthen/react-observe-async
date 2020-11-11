import { interval, Subject } from 'rxjs';
import { map, take, toArray } from 'rxjs/operators';
import { observeAsync, AsyncFactory } from '../src/index';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Thing', () => {
  it('renders without crashing', async () => {
    const interval1 = interval(10).pipe(take(5));
    const interval2 = interval(15).pipe(take(5));
    const factories = new Subject<AsyncFactory<any>>();
    const observable = observeAsync(factories);
    const result = observable
      .pipe(
        map(res => res.result),
        toArray()
      )
      .toPromise();
    factories.next(async observe => {
      const [a, b] = await Promise.all([
        observe(interval1),
        observe(interval2),
      ]);
      return { a, b, version: 1 };
    });
    await sleep(300);
    factories.next(async observe => {
      const a = await observe(interval1);
      const b = await observe(interval2);
      return { a, b, version: 2 };
    });
    await sleep(300);
    factories.next(async observe => {
      const a = await observe(interval1);
      const b = await observe(interval2);
      return { c: a + b, version: 3 };
    });

    factories.complete();
    expect(await result).toMatchSnapshot();
  });
});
