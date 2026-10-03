'use client';

import type { MovementResponse } from '@pesly/shared';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link } from '@/i18n/navigation';
import { dayKey, formatDay, MovementRow } from './movement-row';

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
}

export interface MovementListProps {
  items: readonly MovementListItem[];
  timeZone: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the last "show more" failed; the rows already shown stay. */
  moreError: ErrorMessageKey | undefined;
  onShowMore: () => void;
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
  onShowMore,
}: MovementListProps) {
  const t = useTranslations('movements.list');
  const locale = useLocale();

  return (
    <section className="grid gap-4">
      {items.length === 0 ? (
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
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      <FormAlert error={moreError} />
      {hasMore ? (
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
