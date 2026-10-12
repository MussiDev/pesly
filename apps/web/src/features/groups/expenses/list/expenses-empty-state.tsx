'use client';

import { Receipt } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** A group with no expenses yet, or (month) a month with none, with the way to add one. */
export function ExpensesEmptyState({
  groupId,
  month = false,
}: {
  groupId: string;
  month?: boolean;
}) {
  const t = useTranslations('groups.expenses');
  const tMonth = useTranslations('groups.categoryViews.list.monthEmpty');
  return (
    <EmptyState
      icon={<Receipt aria-hidden="true" />}
      title={month ? tMonth('title') : t('empty.title')}
      description={month ? tMonth('description') : t('empty.description')}
      action={
        <Link
          href={`/groups/${encodeURIComponent(groupId)}/expenses/new`}
          className={buttonVariants()}
        >
          {t('add')}
        </Link>
      }
    />
  );
}
