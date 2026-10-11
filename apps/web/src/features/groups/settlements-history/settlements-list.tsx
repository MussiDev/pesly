'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SettlementRow, type SettlementRowData } from './settlement-row';

interface SettlementsListProps {
  rows: SettlementRowData[];
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  onLoadMore: () => void;
}

/** The loaded settlements, newest first, with the control that follows the cursor. */
export function SettlementsList({
  rows,
  hasMore,
  loadingMore,
  moreFailed,
  onLoadMore,
}: SettlementsListProps) {
  const t = useTranslations('groups.settlements');
  const tApp = useTranslations('app');

  return (
    <div className="grid gap-3">
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <SettlementRow key={row.id} row={row} />
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
