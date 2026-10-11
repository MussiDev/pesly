'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format-amount';
import type { Locale } from '@/i18n/routing';
import type { CurrencyTotal } from './shares-request';

/** One total per currency of what is listed; currencies are never converted into each other. */
export function SharesTotals({
  totals,
  partial,
}: {
  totals: readonly CurrencyTotal[];
  /** More pages remain, so the totals cover only what is loaded so far. */
  partial: boolean;
}) {
  const t = useTranslations('groups.shares.totals');
  const locale = useLocale() as Locale;

  return (
    <section aria-labelledby="shares-totals-title" className="grid gap-2 rounded-card bg-card p-4">
      <h2 id="shares-totals-title" className="text-small font-semibold text-muted-foreground">
        {t('title')}
      </h2>
      <ul className="grid gap-1">
        {totals.map(({ currency, total }) => (
          <li key={currency} className="text-title font-semibold tabular-nums">
            {formatMoney(total, currency, locale)}
          </li>
        ))}
      </ul>
      {partial ? <p className="text-small text-muted-foreground">{t('partial')}</p> : null}
    </section>
  );
}
