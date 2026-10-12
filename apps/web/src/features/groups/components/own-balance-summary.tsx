import { useLocale, useTranslations } from 'next-intl';
import type { AccountCurrency } from '@pesly/shared';
import { formatMoney } from '@/lib/format-amount';

export interface OwnBalanceLine {
  currency: AccountCurrency;
  /** Signed minor units: negative owes, positive is owed. */
  balance: bigint;
}

interface OwnBalanceSummaryProps {
  /** Null when the balances could not be loaded. */
  lines: OwnBalanceLine[] | null;
}

/** The caller's balance in each currency, never mixed. */
export function OwnBalanceSummary({ lines }: OwnBalanceSummaryProps) {
  const t = useTranslations('groups.detail.ownBalance');
  const language = useLocale() === 'en' ? 'en' : 'es';

  return (
    <section aria-label={t('title')} className="grid gap-2">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      {lines === null ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <ul className="grid gap-0.5 text-sm">
          {lines.map(({ currency, balance }) => {
            const amount = formatMoney(balance < 0n ? -balance : balance, currency, language);
            return (
              <li key={currency}>
                {balance === 0n
                  ? t('even', { currency })
                  : balance < 0n
                    ? t('owes', { amount })
                    : t('owed', { amount })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
