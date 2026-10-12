'use client';

import { PiggyBank } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** Shown when the month has no budgets; it offers to create one (FR-05). */
export function BudgetsEmptyState() {
  const t = useTranslations('budgets.list.empty');
  return (
    <EmptyState
      icon={<PiggyBank aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/budgets/new" className={buttonVariants({ size: 'sm' })}>
          {t('action')}
        </Link>
      }
    />
  );
}
