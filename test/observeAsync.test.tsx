import { BehaviorSubject, of, Subject } from 'rxjs';
import { AsyncFactory } from '../src/types';
import { observeAsync, AsyncResult } from '../src/observeAsync';
import { filter, map, toArray } from 'rxjs/operators';

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

describe('ObserveAsync', () => {
  it('renders without crashing', async () => {
    const factories = new BehaviorSubject<AsyncFactory<any>>(async () => {
      return 4;
    });
    const refresh = new Subject();
    const observed: BehaviorSubject<AsyncResult<any, unknown>> = observeAsync(
      factories,
      refresh
    );
    const final = observed.pipe(toArray()).toPromise();
    factories.complete();
    refresh.complete();
    expect(await final).toMatchSnapshot();
  });

  it('renders without crashing', async () => {
    const dependantA = new BehaviorSubject(7);
    const dependantB = new BehaviorSubject(17);
    const refresh = new Subject();
    const observed: BehaviorSubject<AsyncResult<any, unknown>> = observeAsync(
      of(async observe => {
        const depA = await observe(dependantA);
        const depB = await observe(dependantB);
        return [depA, depB];
      }),
      refresh
    );
    const final = observed
      .pipe(
        filter(item => !item.pending),
        map(item => item.result),
        toArray()
      )
      .toPromise();
    dependantA.next(6);
    await sleep(0);
    dependantA.next(7);
    await sleep(0);
    dependantA.next(5);
    dependantB.next(8);
    dependantB.next(8);
    dependantB.next(3);
    dependantB.next(2);
    await sleep(0);
    dependantA.next(9);
    await sleep(0);
    observed.complete();
    expect(await final).toMatchSnapshot();
    console.log(await final);
  });
});
