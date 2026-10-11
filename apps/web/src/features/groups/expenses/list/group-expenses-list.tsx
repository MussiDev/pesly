'use client';

import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ExpenseRow, type ExpenseRowProps } from './expense-row';
import { ExpensesEmptyState } from './expenses-empty-state';

export interface ExpenseListItem extends ExpenseRowProps {
  id: string;
}

export interface GroupExpensesListProps {
  groupId: string;
  items: readonly ExpenseListItem[];
  hasMore: boolean;
  loadingMore: boolean;
  /** A translated reason the last "load more" failed. */
  loadMoreError: string | undefined;
  onLoadMore: () => void;
}

/** The expenses loaded so far; pure, the container owns the paging. */
export function GroupExpensesList({
  groupId,
  items,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: GroupExpensesListProps) {
  const t = useTranslations('groups.expenses');
  const tApp = useTranslations('app');

  if (items.length === 0) return <ExpensesEmptyState groupId={groupId} />;

  return (
    <div className="grid gap-4">
      <Link
        href={`/groups/${encodeURIComponent(groupId)}/expenses/new`}
        className={buttonVariants()}
      >
        {t('add')}
      </Link>
      <ul className="divide-y divide-border/70 rounded-card bg-card px-4" aria-label={t('label')}>
        {items.map(({ id, ...row }) => (
          <li key={id}>
            <ExpenseRow {...row} />
          </li>
        ))}
      </ul>
      {loadMoreError === undefined ? null : (
        <p role="alert" className="text-small text-destructive">
          {loadMoreError}
        </p>
      )}
      {hasMore ? (
        <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
          {loadMoreError === undefined ? t('loadMore') : tApp('retry')}
        </Button>
      ) : null}
    </div>
  );
}
