import { BehaviorSubject, of } from 'rxjs';
import { AsyncResult } from '../src/types';
import { observeAsync } from '../src/observeAsync';
import { filter, map, take, toArray } from 'rxjs/operators';
import { shareAsync, syncState, asyncState } from '../src';

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

let WRef: any = (global as any).WeakRef;

let subjects: any[] = [];

function register(obj: any) {
  if (!subjects) {
    subjects = [];
  }
  if (!WRef) {
    WRef = (global as any).WeakRef;
  }
  subjects.push(new WRef(obj));
}

jest.mock('rxjs/internal/Subscription', () => {
  const actual = jest.requireActual('rxjs/internal/Subscription');
  class Subscription extends actual.Subscription {
    constructor(...args: []) {
      super(...args);
      register(this);
    }
  }
  return { ...actual, Subscription };
});

jest.mock('rxjs/internal/Observable', () => {
  const actual = jest.requireActual('rxjs/internal/Observable');
  class Observable extends actual.Observable {
    constructor(...args: []) {
      super(...args);
      register(this);
    }
  }
  return { ...actual, Observable };
});

jest.mock('rxjs', () => {
  const actual = jest.requireActual('rxjs');
  class Subject extends actual.Subject {
    constructor() {
      super();
      register(this);
    }
  }

  class BehaviorSubject extends actual.BehaviorSubject {
    constructor(...args: any[]) {
      super(...args);
      register(this);
    }
  }

  class ReplaySubject extends actual.ReplaySubject {
    constructor(...args: any[]) {
      super(...args);
      register(this);
    }
  }

  class Observable extends actual.Observable {
    constructor(...args: any[]) {
      super(...args);
      register(this);
    }
  }
  return {
    ...actual,
    Subject,
    BehaviorSubject,
    ReplaySubject,
    Observable,
  };
});

function verify(fn: () => Promise<void>) {
  return async () => {
    subjects.splice(0, subjects.length);
    global.gc();
    await fn();
    await sleep(10);
    global.gc();
    await sleep(10);
    const refs = subjects.map(sub => sub.deref());
    const notClean = refs.some(v => v);
    if (notClean) {
      throw new Error('Observables was not garbage collected in time');
    }
  };
}

describe('ObserveAsync', () => {
  it(
    'works with simple case',
    verify(async () => {
      const observed: BehaviorSubject<AsyncResult<any, unknown>> = observeAsync(
        of(async () => 4)
      );
      const final = observed.pipe(take(2), toArray()).toPromise();
      await sleep(0);
      expect(await final).toMatchSnapshot();
    })
  );

  it(
    'works with some dependants',
    verify(async () => {
      const dependantA = new BehaviorSubject(7);
      const dependantB = new BehaviorSubject(17);
      const observed: BehaviorSubject<AsyncResult<any, unknown>> = observeAsync(
        of(async observe => {
          const depA = await observe(dependantA);
          const depB = await observe(dependantB);
          return [depA, depB];
        })
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
      dependantA.complete();
      dependantB.complete();
      expect(await final).toMatchSnapshot();
    })
  );
});

describe('Share async', () => {
  it(
    'should unsubscribe as expected',
    verify(async () => {
      let finals = 0;
      let starts = 0;
      const shared = shareAsync(
        async () => {
          starts += 1;
          return 5;
        },
        () => {
          finals += 1;
        }
      );
      const sub1 = shared.subscribe();
      const sub2 = shared.subscribe();
      const sub3 = shared.subscribe();
      sub1.unsubscribe();
      sub2.unsubscribe();
      sub3.unsubscribe();
      expect(finals).toEqual(1);
      expect(starts).toEqual(1);
      const sub4 = shared.subscribe();
      const sub5 = shared.subscribe();
      expect(starts).toEqual(2);
      expect(finals).toEqual(1);
      sub4.unsubscribe();
      sub5.unsubscribe();
      expect(finals).toEqual(2);
      expect(starts).toEqual(2);
    })
  );
});

describe('syncState', () => {
  it(
    'should work',
    verify(async () => {
      const state = syncState(15);
      const promise = state.pipe(toArray()).toPromise();
      state.dispatch(12);
      state.dispatch(() => 20);
      state.dispatch(v => v + 20);
      state.unsubscribe();
      expect(await promise).toMatchSnapshot();
    })
  );
});

describe('asyncState', () => {
  it(
    'should work',
    verify(async () => {
      const state = asyncState(15);
      const promise = state.pipe(toArray()).toPromise();
      state.dispatch(13);
      state.dispatch(() => 23);
      state.dispatch(v => v + 23);
      state.unsubscribe();
      expect(await promise).toMatchSnapshot();
    })
  );
});
