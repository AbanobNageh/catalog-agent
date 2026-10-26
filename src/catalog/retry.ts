import { CatalogError } from './errors.js';

/** Injected so unit tests can run backoff and timing without waiting (a fake clock). */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 2000;

/**
 * Exponential backoff with "full jitter": a random wait between 0 and
 * min(2000, 200 × 2^attempt) ms. The randomness spreads out clients that
 * failed at the same moment, so they don't all retry together.
 */
export function backoffDelay(attempt: number, random: () => number): number {
  return random() * Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
}

export interface RetryOptions {
  clock: Clock;
  random: () => number;
  maxRetries: number;
}

/**
 * Runs a read, retrying only a transient failure (UNAVAILABLE: 503, timeout,
 * connection error). Never used for writes (ADR-0004).
 */
export async function withReadRetries<T>(
  fn: (retry: number) => Promise<T>,
  { clock, random, maxRetries }: RetryOptions,
): Promise<{ value: T; retries: number }> {
  for (let retries = 0; ; retries++) {
    try {
      return { value: await fn(retries), retries };
    } catch (err) {
      const transient =
        err instanceof CatalogError && err.code === 'UNAVAILABLE';
      if (!transient) throw err;
      if (retries === maxRetries) {
        err.retries = retries;
        throw err;
      }
      await clock.sleep(backoffDelay(retries, random));
    }
  }
}
