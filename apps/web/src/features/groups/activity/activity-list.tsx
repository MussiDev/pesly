'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ActivityEntryRow, type ActivityEntryData } from './activity-entry';

interface ActivityListProps {
  entries: ActivityEntryData[];
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  onLoadMore: () => void;
}

/** The loaded entries, newest first, with the control that follows the cursor. */
export function ActivityList({
  entries,
  hasMore,
  loadingMore,
  moreFailed,
  onLoadMore,
}: ActivityListProps) {
  const t = useTranslations('groups.activity');
  const tApp = useTranslations('app');

  return (
    <div className="grid gap-3">
      <ul className="divide-y divide-border">
        {entries.map((entry) => (
          <ActivityEntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
      {moreFailed ? (
        <div role="alert" className="grid gap-2 text-small text-destructive">
          <p>{t('loadMoreFailed')}</p>
          <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {tApp('retry')}
          </Button>
        </div>
      ) : hasMore ? (
        <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
