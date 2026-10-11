'use client';

import { useTranslations } from 'next-intl';
import { ListRow } from '@/components/ui/list-row';

export interface ExpenseRowProps {
  description: string;
  category: string;
  payer: string;
  /** Already formatted with its currency. */
  amount: string;
  date: string;
  /** The viewer's own share, formatted; absent when the viewer holds none or is unknown. */
  share: string | undefined;
}

/** One expense of the group. */
export function ExpenseRow({ description, category, payer, amount, date, share }: ExpenseRowProps) {
  const t = useTranslations('groups.expenses');
  return (
    <ListRow
      title={description}
      description={
        <span className="grid gap-0.5">
          <span>{category}</span>
          <span>{t('paidBy', { name: payer })}</span>
          <span>{date}</span>
          {share === undefined ? null : <span>{t('yourShare', { amount: share })}</span>}
        </span>
      }
      trailing={<span className="font-medium tabular-nums">{amount}</span>}
    />
  );
}
