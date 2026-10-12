const LOCALE: Record<'en' | 'es', string> = { en: 'en-US', es: 'es-AR' };

/** `YYYY-MM` as a month and year in the active locale, e.g. "October 2026". */
export function formatMonth(month: string, language: 'en' | 'es'): string {
  const [year = 0, index = 1] = month.split('-').map((part) => Number.parseInt(part, 10));
  return new Intl.DateTimeFormat(LOCALE[language], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, index - 1, 1)));
}

/**
 * Basis points (0 to 10000) as a percentage in the active locale. The only place a basis-point
 * number becomes a float, and only for display (D6); no money value comes through here.
 */
export function formatShare(basisPoints: number, language: 'en' | 'es'): string {
  return new Intl.NumberFormat(LOCALE[language], {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(basisPoints / 10000);
}

/**
 * `total * 10000 / currencyTotal` rounded half up, computed in `bigint` (D6); 0 when the currency
 * total is 0. The result is a basis-point count, never money, so it is safe as a number.
 */
export function shareOf(total: bigint, currencyTotal: bigint): number {
  if (currencyTotal === 0n) return 0;
  return Number((2n * total * 10000n + currencyTotal) / (2n * currencyTotal));
}
