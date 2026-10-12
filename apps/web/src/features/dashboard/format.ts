import type { Locale } from '@/i18n/routing';

const NUMBER_LOCALE: Record<Locale, string> = { en: 'en-US', es: 'es-AR' };
const MINUS = '−';

/** A whole number with the locale's grouping; never a float. */
export function formatCount(count: number, locale: Locale): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], { maximumFractionDigits: 0 }).format(count);
}

/** A whole-number percent, for example "60%". */
export function formatWholePercent(percent: number, locale: Locale): string {
  return `${formatCount(percent, locale)}%`;
}

/** An explicit "+" or "−" (U+2212) before the whole percent, none for 0. */
export function formatSignedPercent(change: number, locale: Locale): string {
  if (change === 0) return formatWholePercent(0, locale);
  const sign = change > 0 ? '+' : MINUS;
  return `${sign}${formatWholePercent(Math.abs(change), locale)}`;
}
