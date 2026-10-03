import { formatScaledRate } from '@pesly/shared';

/**
 * A rate scaled by 10,000 for display: 2 to 4 decimals in the locale's notation (always 4 when
 * `minimumFractionDigits` is 4, as the implied rate of an exchange shows). The exact decimal
 * string goes to Intl, so no float is created.
 */
export function formatRate(value: bigint, locale: string, minimumFractionDigits = 2): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits: 4,
  }).format(formatScaledRate(value) as `${number}`);
}
