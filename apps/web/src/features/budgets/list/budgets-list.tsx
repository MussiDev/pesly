'use client';

import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/navigation';
import type { BudgetView } from '../helpers/budget-view';
import { BudgetCard } from './budget-card';
import { BudgetsEmptyState } from './budgets-empty-state';

/** The page header with the create action. */
export function BudgetsHeader() {
  const t = useTranslations('budgets.list');
  return (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <Link href="/budgets/new" className={buttonVariants({ size: 'sm' })}>
          {t('create')}
        </Link>
      }
    />
  );
}

/** The budgets of the month, or the empty state. */
export function BudgetsList({ budgets }: { budgets: readonly BudgetView[] }) {
  if (budgets.length === 0) return <BudgetsEmptyState />;
  return (
    <ul className="grid gap-3">
      {budgets.map((budget) => (
        <BudgetCard key={budget.id} budget={budget} />
      ))}
    </ul>
  );
}
