import { describe, expect, it } from 'vitest';
import { formatPrice } from './money.js';

describe('formatPrice', () => {
  it.each([
    [0, '0.00 EGP'],
    [5, '0.05 EGP'],
    [99, '0.99 EGP'],
    [100, '1.00 EGP'],
    [79900, '799.00 EGP'],
    [1999999, '19999.99 EGP'],
    // int32 max, catalog-api's upper bound: exact, no float rounding.
    [2147483647, '21474836.47 EGP'],
  ])('%i cents → %s', (cents, expected) => {
    expect(formatPrice(cents, 'EGP')).toBe(expected);
  });

  it('uses the given currency code', () => {
    expect(formatPrice(1250, 'USD')).toBe('12.50 USD');
  });
});
