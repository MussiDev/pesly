'use client';

import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';
import { ExpenseRow, type ExpenseRowProps } from './expense-row';
import { ExpensesEmptyState } from './expenses-empty-state';

export interface ExpenseListItem extends ExpenseRowProps {
  id: string;
}

/** The total of the selected categories in one currency, already formatted. */
export interface FilteredTotalItem {
  currency: string;
  amount: string;
  count: number;
}

export interface GroupExpensesListProps {
  groupId: string;
  items: readonly ExpenseListItem[];
  hasMore: boolean;
  loadingMore: boolean;
  /** A translated reason the last "load more" failed. */
  loadMoreError: string | undefined;
  onLoadMore: () => void;
  /** A category filter is active (AC-15, AC-17). */
  filtered?: boolean;
  /** The list is one month of the group, so an empty page is a month-empty state (AC-16). */
  monthScoped?: boolean;
  /** Per currency, from the summary; shown above the rows while a filter is active (D10). */
  filteredTotals?: readonly FilteredTotalItem[];
  onClearFilter?: () => void;
  /** A translated reason the page after a filter change failed; the rows stay on screen. */
  reloadError?: string;
}

/** The expenses loaded so far; pure, the container owns the paging. */
export function GroupExpensesList({
  groupId,
  items,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  filtered = false,
  monthScoped = false,
  filteredTotals,
  onClearFilter,
  reloadError,
}: GroupExpensesListProps) {
  const t = useTranslations('groups.expenses');
  const tApp = useTranslations('app');
  const tList = useTranslations('groups.categoryViews.list');
  const tSummary = useTranslations('groups.categoryViews.summary');

  const failure =
    reloadError === undefined ? null : (
      <p role="alert" className="text-small text-destructive">
        {reloadError}
      </p>
    );

  if (items.length === 0) {
    const empty =
      filtered && monthScoped ? (
        <EmptyState
          icon={<SearchX aria-hidden="true" />}
          title={tList('noMatch.title')}
          description={tList('noMatch.description')}
          action={
            onClearFilter === undefined ? undefined : (
              <Button variant="outline" onClick={onClearFilter}>
                {tList('noMatch.clear')}
              </Button>
            )
          }
        />
      ) : (
        <ExpensesEmptyState groupId={groupId} month={monthScoped} />
      );
    return (
      <div className="grid gap-4">
        {failure}
        {empty}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {failure}
      {filtered && filteredTotals !== undefined && filteredTotals.length > 0 ? (
        <section
          aria-label={tList('filteredTotal.label')}
          className="grid gap-1 rounded-card bg-card px-4 py-3"
        >
          {filteredTotals.map((entry) => (
            <p key={entry.currency} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium tabular-nums">{entry.amount}</span>
              <span className="text-small text-muted-foreground">
                {tSummary('expenses', { count: entry.count })}
              </span>
            </p>
          ))}
        </section>
      ) : null}
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
