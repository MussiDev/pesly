'use client';

import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/navigation';
import type { GoalView } from '../helpers/goal-view';
import { GoalCard } from './goal-card';
import { GoalsEmptyState } from './goals-empty-state';

/** The page header with the create action. */
export function GoalsHeader() {
  const t = useTranslations('goals.list');
  return (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <Link href="/goals/new" className={buttonVariants({ size: 'sm' })}>
          {t('create')}
        </Link>
      }
    />
  );
}

/** The header, then the goals or the empty state. */
export function GoalsList({ goals }: { goals: readonly GoalView[] }) {
  return (
    <div className="grid gap-6">
      <GoalsHeader />
      {goals.length === 0 ? (
        <GoalsEmptyState />
      ) : (
        <ul className="grid gap-3">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </ul>
      )}
    </div>
  );
}
