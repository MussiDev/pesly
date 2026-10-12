import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';

const MINUS = '−';

/** Money with an explicit sign: plus above zero, a true minus below it, none at zero. */
export function signedMoney(amount: bigint, currency: 'ARS' | 'USD', locale: Locale): string {
  if (amount === 0n) return formatMoney(0n, currency, locale);
  return amount > 0n
    ? `+${formatMoney(amount, currency, locale)}`
    : `${MINUS}${formatMoney(-amount, currency, locale)}`;
}
