'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface SettlementTotalView {
  key: string;
  payer: string;
  payee: string;
  /** Already formatted in its currency. */
  amount: string;
  count: number;
}

/** What each member paid another, over every settlement of the group, so nobody adds it up. */
export function SettlementsTotals({ totals }: { totals: SettlementTotalView[] }) {
  const t = useTranslations('groups.settlements.totals');

  return (
    <section aria-labelledby="settlements-totals" className="grid gap-3 rounded-card bg-card p-4">
      <h2
        id="settlements-totals"
        className="text-caption font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {t('title')}
      </h2>
      <ul role="list" className="grid gap-3">
        {totals.map((total) => (
          <li key={total.key} className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <span className="grid min-w-0 gap-0.5">
              <span className="flex flex-wrap items-center gap-1 text-small font-semibold break-words">
                {total.payer}
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="sr-only">{t('to')}</span>
                {total.payee}
              </span>
              <span className="text-caption text-muted-foreground">
                {t('count', { count: total.count })}
              </span>
            </span>
            <span className="text-heading font-bold break-words tabular-nums">{total.amount}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
