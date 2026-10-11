'use client';

import { Receipt } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** A group with no expenses yet, with the way to add the first one. */
export function ExpensesEmptyState({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.expenses');
  return (
    <EmptyState
      icon={<Receipt aria-hidden="true" />}
      title={t('empty.title')}
      description={t('empty.description')}
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
