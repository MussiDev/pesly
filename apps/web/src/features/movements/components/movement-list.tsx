'use client';

import type { MovementResponse } from '@pesly/shared';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link } from '@/i18n/navigation';
import { dayKey, formatDay, MovementRow } from './movement-row';
import { MovementsLoadStateView, type MovementsLoadState } from './movements-load-state';

/** One movement with the names of the account and category already resolved. */
export interface MovementListItem {
  movement: MovementResponse;
  accountName: string | undefined;
  currency: string | undefined;
  categoryName: string | undefined;
  categoryIcon?: string;
  categoryColor?: string;
  destinationAccountName: string | undefined;
  destinationCurrency: string | undefined;
  /** Kept on this device and not sent yet: it shows a badge and cannot be edited or deleted. */
  pending?: boolean;
}

export interface MovementListProps {
  items: readonly MovementListItem[];
  timeZone: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the last "show more" failed; the rows already shown stay. */
  moreError: ErrorMessageKey | undefined;
  /** Edit and delete on every row, with the inline delete confirmation; absent, rows are read-only. */
  rowActions?: MovementListRowActions;
  onShowMore: () => void;
  /** The filter bar; it stays mounted while the rows below reload. */
  filterBar?: ReactNode;
  /** Whether any filter is on: an empty list then means "no matches", not "no history". */
  filtersActive?: boolean;
  /** Clears every filter; offered with the no-matches message. */
  onClearFilters?: (() => void) | undefined;
  /** The rows come from the copy kept on the device: say so, because the filters are off. */
  offlineNotice?: boolean;
  /** While the rows (re)load or fail to load, this replaces them and the bar stays. */
  loadState?: MovementsLoadState | undefined;
  onRetry?: (() => void) | undefined;
}

export interface MovementListRowActions {
  /** The movement whose delete confirmation is open. */
  confirmingDeleteId: string | undefined;
  /** A delete is in flight. */
  pending: boolean;
  /** Why the last delete failed; the row stays. */
  error: ErrorMessageKey | undefined;
  onAskDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}

interface DayGroup {
  key: string;
  occurredAt: string;
  items: MovementListItem[];
}

/** Consecutive items of the same day (in the user's zone) share a group; the order is kept. */
function groupByDay(items: readonly MovementListItem[], timeZone: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const key = dayKey(item.movement.occurredAt, timeZone);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, occurredAt: item.movement.occurredAt, items: [item] });
  }
  return groups;
}

export function MovementList({
  items,
  timeZone,
  hasMore,
  loadingMore,
  moreError,
  rowActions,
  onShowMore,
  filterBar,
  filtersActive = false,
  onClearFilters,
  offlineNotice = false,
  loadState,
  onRetry,
}: MovementListProps) {
  const t = useTranslations('movements.list');
  const tFilters = useTranslations('movements.filters');
  const locale = useLocale();

  return (
    <section className="grid gap-4">
      {filterBar}
      {offlineNotice ? (
        <p role="status" className="text-small text-muted-foreground">
          {t('offlineNotice')}
        </p>
      ) : null}
      {loadState !== undefined ? (
        <MovementsLoadStateView state={loadState} onRetry={onRetry ?? (() => undefined)} />
      ) : items.length === 0 ? (
        filtersActive ? (
          <div className="grid gap-3">
            <p className="text-body text-muted-foreground">{tFilters('noMatch')}</p>
            {onClearFilters === undefined ? null : (
              <Button variant="outline" onClick={onClearFilters}>
                {tFilters('showAll')}
              </Button>
            )}
          </div>
        ) : (
          <EmptyState
            headingAs="h2"
            title={t('emptyTitle')}
            description={t('empty')}
            action={
              <Link href="/movements/new" className={buttonVariants()}>
                <Plus aria-hidden />
                {t('newMovement')}
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className="flex justify-end">
            <Link href="/movements/new" className={buttonVariants({ size: 'sm' })}>
              <Plus aria-hidden />
              {t('newMovement')}
            </Link>
          </div>
          {groupByDay(items, timeZone).map((group) => (
            <section key={group.key} className="grid gap-1">
              <h2 className="px-1 text-small font-medium text-muted-foreground">
                <time dateTime={group.key}>{formatDay(group.occurredAt, locale, timeZone)}</time>
              </h2>
              {/* An explicit role: list-style reset classes can drop the implicit one in Safari. */}
              <ul
                role="list"
                className="divide-y divide-border rounded-xl border bg-card px-3 shadow-xs"
              >
                {group.items.map((item) => (
                  <MovementRow
                    key={item.movement.id}
                    movement={item.movement}
                    accountName={item.accountName}
                    currency={item.currency}
                    categoryName={item.categoryName}
                    categoryIcon={item.categoryIcon}
                    categoryColor={item.categoryColor}
                    destinationAccountName={item.destinationAccountName}
                    destinationCurrency={item.destinationCurrency}
                    timeZone={timeZone}
                    pending={item.pending === true}
                    actions={
                      rowActions === undefined || item.pending === true
                        ? undefined
                        : {
                            pending: rowActions.pending,
                            confirmingDelete: rowActions.confirmingDeleteId === item.movement.id,
                            onAskDelete: () => {
                              rowActions.onAskDelete(item.movement.id);
                            },
                            onConfirmDelete: () => {
                              rowActions.onConfirmDelete(item.movement.id);
                            },
                            onCancelDelete: rowActions.onCancelDelete,
                          }
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      <FormAlert error={moreError} />
      <FormAlert error={rowActions?.error} />
      {hasMore && loadState === undefined ? (
        <Button
          variant="outline"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={onShowMore}
        >
          {t('showMore')}
        </Button>
      ) : null}
    </section>
  );
}
