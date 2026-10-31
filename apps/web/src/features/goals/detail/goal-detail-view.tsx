'use client';

import type { GoalEntryResponse, GoalResponse, RecordGoalEntryResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link } from '@/i18n/navigation';
import { GoalDeleteAction } from '../delete/goal-delete-action';
import { GoalEntryActions } from '../entries/goal-entry-actions';
import { toGoalView } from '../helpers/goal-view';
import { GoalProgress } from '../list/goal-progress';
import { GoalEntriesList } from './goal-entries-list';

interface GoalDetailViewProps {
  goal: GoalResponse;
  /** Null for a goal linked to an account: it has no history. */
  entries: ReadonlyArray<GoalEntryResponse> | null;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: ErrorMessageKey | null;
  onLoadMore: () => void;
  onRecorded: (response: RecordGoalEntryResponse) => void;
  onDeleted: () => void;
}

/** One goal: its figures, the entry forms, the history and the edit and delete actions. */
export function GoalDetailView({
  goal,
  entries,
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
  onRecorded,
  onDeleted,
}: GoalDetailViewProps) {
  const t = useTranslations('goals.detail');
  return (
    <div className="grid gap-6">
      <PageHeader
        title={goal.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/goals/${encodeURIComponent(goal.id)}/edit`}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('edit')}
            </Link>
          </div>
        }
      />
      <GoalProgress goal={toGoalView(goal)} />
      <GoalEntryActions goal={goal} onRecorded={onRecorded} />
      {entries === null ? null : (
        <GoalEntriesList
          entries={entries}
          currency={goal.currency}
          hasMore={hasMore}
          loadingMore={loadingMore}
          moreError={moreError}
          onLoadMore={onLoadMore}
        />
      )}
      <GoalDeleteAction goalId={goal.id} onDeleted={onDeleted} />
    </div>
  );
}
