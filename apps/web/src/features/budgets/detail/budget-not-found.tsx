'use client';

import { PiggyBank } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** The budget does not exist, is not the user's or has no version in the month; all look the same. */
export function BudgetNotFound() {
  const t = useTranslations('budgets.detail.notFound');
  return (
    <EmptyState
      icon={<PiggyBank aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/budgets" className={buttonVariants()}>
          {t('back')}
        </Link>
      }
    />
  );
}
