'use client';

import {
  GOAL_ENTRIES_PAGE_SIZE_MAX,
  type GoalEntryResponse,
  type GoalResponse,
} from '@pesly/shared';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import type { Locale } from '@/i18n/routing';
import { formatDateTime, formatMoney } from '@/lib/format-amount';

interface GoalEntriesListProps {
  entries: ReadonlyArray<GoalEntryResponse>;
  currency: GoalResponse['currency'];
  hasMore: boolean;
  loadingMore: boolean;
  /** Why the last "load more" failed; the shown entries stay. */
  moreError: ErrorMessageKey | null;
  onLoadMore: () => void;
}

/** The entries of a goal, newest first, with the control that asks for more. */
export function GoalEntriesList({
  entries,
  currency,
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
}: GoalEntriesListProps) {
  const t = useTranslations('goals.detail.entries');
  const tErrors = useTranslations('errors');
  const tApp = useTranslations('app');
  const locale = useLocale();
  const language: Locale = locale === 'en' ? 'en' : 'es';
  const timeZone = useTimeZone() ?? 'UTC';

  return (
    <section aria-labelledby="goal-entries-title" className="grid gap-3">
      <h2 id="goal-entries-title" className="text-h3">
        {t('title')}
      </h2>
      {entries.length >= GOAL_ENTRIES_PAGE_SIZE_MAX ? (
        <p className="text-small text-muted-foreground">
          {t('latestNote', { count: GOAL_ENTRIES_PAGE_SIZE_MAX })}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-3">
              <div className="grid">
                <span>{t(entry.kind)}</span>
                <span className="text-small text-muted-foreground">
                  {formatDateTime(entry.createdAt, timeZone, language)}
                </span>
              </div>
              <span className="tabular-nums">
                {formatMoney(BigInt(entry.amount), currency, language)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {moreError !== null ? (
        <div role="alert" className="grid gap-2 text-small text-destructive">
          <p>{tErrors(moreError)}</p>
          <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {tApp('retry')}
          </Button>
        </div>
      ) : hasMore ? (
        <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
          {t('loadMore')}
        </Button>
      ) : null}
    </section>
  );
}
