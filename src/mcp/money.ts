/**
 * Integer cents as a readable price: 79900 → "799.00 EGP". Integer arithmetic
 * only, so no float rounding. Two minor digits, as for EGP, the catalogue's
 * currency; no thousands separators, so a model can't misread them.
 */
export function formatPrice(cents: number, currency: string): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const major = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `${sign}${major}.${minor} ${currency}`;
}
