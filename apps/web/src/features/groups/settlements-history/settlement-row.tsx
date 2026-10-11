'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

export interface SettlementRowData {
  id: string;
  payer: string;
  payee: string;
  /** Already formatted in the settlement currency. */
  amount: string;
  /** Already formatted in the user's time zone. */
  date: string;
  consolidated: boolean;
}

/** One recorded settlement, read-only. */
export function SettlementRow({ row }: { row: SettlementRowData }) {
  const t = useTranslations('groups.settlements');

  return (
    <li className="grid gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-small font-semibold break-words">
          {t('parties', { payer: row.payer, payee: row.payee })}
        </span>
        {row.consolidated ? <Badge variant="info">{t('consolidated')}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-small">
        <span className="font-semibold">{row.amount}</span>
        <span className="text-muted-foreground">{row.date}</span>
      </div>
    </li>
  );
}
