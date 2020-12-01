import { BehaviorSubject, of, Subject } from 'rxjs';
import { AsyncResult } from '../src/types';
import { observeAsync } from '../src/observeAsync';
import { filter, map, take, toArray } from 'rxjs/operators';

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
    global.gc();
    const refs = subjects.map(sub => sub.deref());
    const notClean = refs.some(v => v);
    if (notClean) {
      console.log(refs);
      throw new Error(' observables was not garbage collected in time');
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
      refresh.complete();
      dependantA.complete();
      dependantB.complete();
      expect(await final).toMatchSnapshot();
    })
  );
});
