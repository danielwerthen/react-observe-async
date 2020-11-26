import { BehaviorSubject, Subject } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { observeAsync, AsyncFactory } from '../src/index';

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

describe('Thing', () => {
  it('renders without crashing', async () => {
    const subject = new Subject();
    const factory: AsyncFactory<any> = async observe => {
      await observe(subject);
      console.log('Attempt');
      await sleep(100);
      return { alpha: 4 };
    };
    const factories = new BehaviorSubject(factory);
    const observable = factories.pipe(observeAsync());
    const result = observable.pipe(toArray()).toPromise();
    subject.next(1);
    await sleep(200);
    subject.next(1);
    subject.complete();
    factories.complete();
    const final = await result;
    console.log(final);
    // expect(final).toMatchSnapshot();
  });
});
