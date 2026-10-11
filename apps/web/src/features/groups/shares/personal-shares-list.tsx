'use client';

import type { PersonalShareResponse } from '@pesly/shared';
import { dateInTimeZone } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import { formatMoney } from '@/lib/format-amount';

interface PersonalSharesListProps {
  items: readonly PersonalShareResponse[];
  timeZone: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Every listed share: its day, the user's part and, when the user paid, what is still owed to them.
 * The response carries the group id only, so each row links to its group.
 */
export function PersonalSharesList({
  items,
  timeZone,
  hasMore,
  loadingMore,
  onLoadMore,
}: PersonalSharesListProps) {
  const t = useTranslations('groups.shares');
  const locale = useLocale() as Locale;

  return (
    <div className="grid gap-4">
      <ul
        role="list"
        aria-label={t('listLabel')}
        className="divide-y divide-border/70 rounded-card bg-card px-4"
      >
        {items.map((item) => {
          const day = dateInTimeZone(new Date(item.occurredAt), timeZone);
          return (
            <li key={item.expenseId} className="grid gap-1 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <time dateTime={day} className="text-small text-muted-foreground">
                  {formatCalendarDate(day, locale)}
                </time>
                <span className="font-semibold tabular-nums">
                  {formatMoney(BigInt(item.shareAmount), item.currency, locale)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-small">
                <Link
                  href={`/groups/${encodeURIComponent(item.groupId)}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {t('openGroup')}
                </Link>
                {item.receivableAmount === null ? null : (
                  <span className="text-muted-foreground">
                    {t('receivable')}{' '}
                    <span className="tabular-nums">
                      {formatMoney(BigInt(item.receivableAmount), item.currency, locale)}
                    </span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <div>
          <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
