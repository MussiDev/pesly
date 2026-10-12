'use client';

import { useTranslations } from 'next-intl';

export interface SettlementSummary {
  payer: string;
  payee: string;
  /** Already formatted with the currency. */
  amount: string;
}

/** "A pays B amount" in words, so the direction is read before anything is sent. */
export function SettlementDirectionSummary({ summary }: { summary: SettlementSummary | null }) {
  const t = useTranslations('groups.settlement');
  return (
    <p aria-live="polite" className="rounded-xl bg-muted px-3 py-2 text-body font-semibold">
      {summary === null
        ? t('summaryIncomplete')
        : t('summary', { payer: summary.payer, payee: summary.payee, amount: summary.amount })}
    </p>
  );
}
