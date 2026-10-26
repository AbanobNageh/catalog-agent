import { describe, expect, it } from 'vitest';
import { CatalogError } from './errors.js';
import { backoffDelay, withReadRetries, type Clock } from './retry.js';

/** A clock that records sleeps instead of waiting. */
function fakeClock(): Clock & { sleeps: number[] } {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
}

const unavailable = () => new CatalogError('UNAVAILABLE', 'down', true, 503);

/** fn that fails with the given errors in turn, then returns 'ok'. */
function failing(...errors: Error[]) {
  let calls = 0;
  const fn = () => {
    const err = errors[calls++];
    return err ? Promise.reject(err) : Promise.resolve('ok');
  };
  return { fn, calls: () => calls };
}

describe('backoffDelay (full jitter)', () => {
  it.each([
    [0, 200],
    [1, 400],
    [2, 800],
    [3, 1600],
    [4, 2000],
    [10, 2000],
  ])('attempt %i: between 0 and %i ms', (attempt, cap) => {
    expect(backoffDelay(attempt, () => 0)).toBe(0);
    const high = backoffDelay(attempt, () => 0.999999);
    expect(high).toBeLessThan(cap);
    expect(high).toBeGreaterThan(cap * 0.99);
  });
});

describe('withReadRetries', () => {
  const options = (clock: Clock, random = () => 0.5) => ({
    clock,
    random,
    maxRetries: 2,
  });

  it('returns at once when the first call works', async () => {
    const clock = fakeClock();
    const { fn, calls } = failing();
    await expect(withReadRetries(fn, options(clock))).resolves.toEqual({
      value: 'ok',
      retries: 0,
    });
    expect(calls()).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('retries UNAVAILABLE with growing, jittered waits', async () => {
    const clock = fakeClock();
    const { fn, calls } = failing(unavailable(), unavailable());
    await expect(withReadRetries(fn, options(clock))).resolves.toEqual({
      value: 'ok',
      retries: 2,
    });
    expect(calls()).toBe(3);
    expect(clock.sleeps).toEqual([100, 200]); // random 0.5 × 200, × 400
  });

  it('gives up after 2 retries (3 calls) and reports the retries', async () => {
    const clock = fakeClock();
    const last = unavailable();
    const { fn, calls } = failing(unavailable(), unavailable(), last);
    const err = await withReadRetries(fn, options(clock)).catch(
      (e: unknown) => e,
    );
    expect(err).toBe(last);
    expect((err as CatalogError & { retries?: number }).retries).toBe(2);
    expect(calls()).toBe(3);
  });

  it.each([
    'NOT_FOUND',
    'VALIDATION',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'INTERNAL',
  ] as const)('never retries %s', async (code) => {
    const clock = fakeClock();
    const err = new CatalogError(code, 'no', false, 400);
    const { fn, calls } = failing(err);
    await expect(withReadRetries(fn, options(clock))).rejects.toBe(err);
    expect(calls()).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('never retries a bug (a non-CatalogError)', async () => {
    const clock = fakeClock();
    const { fn, calls } = failing(new RangeError('bug'));
    await expect(withReadRetries(fn, options(clock))).rejects.toThrow('bug');
    expect(calls()).toBe(1);
  });
});
