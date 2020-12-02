import { shareAsync } from '../src/index';

describe('Share async', () => {
  it('should unsubscribe as expected', () => {
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
  });
});
