'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface SyncStatusProps {
  /** Changes kept on this device that wait to be sent. */
  pending: number;
  /** Changes the server refused, waiting for the person. */
  failed: number;
  /** Group changes kept on this device that wait to be sent. */
  groupWaiting?: number;
  /** Group changes the server refused. */
  groupFailed?: number;
  /** Group changes that collided with a newer server copy. */
  groupConflict?: number;
}

/** How many changes are not on the server yet; nothing at all when there are none. */
export function SyncStatus({
  pending,
  failed,
  groupWaiting = 0,
  groupFailed = 0,
  groupConflict = 0,
}: SyncStatusProps) {
  const t = useTranslations('app.sync');
  if (
    pending === 0 &&
    failed === 0 &&
    groupWaiting === 0 &&
    groupFailed === 0 &&
    groupConflict === 0
  )
    return null;
  return (
    <div
      role="status"
      className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-3 text-small text-muted-foreground"
    >
      {pending > 0 ? <span>{t('waiting', { count: pending })}</span> : null}
      {failed > 0 ? (
        <Link href="/movements" className="text-destructive underline underline-offset-4">
          {t('failed', { count: failed })}
        </Link>
      ) : null}
      {groupWaiting > 0 ? (
        <Link href="/groups" className="underline underline-offset-4">
          {t('groupWaiting', { count: groupWaiting })}
        </Link>
      ) : null}
      {groupFailed > 0 ? (
        <Link href="/groups" className="text-destructive underline underline-offset-4">
          {t('groupFailed', { count: groupFailed })}
        </Link>
      ) : null}
      {groupConflict > 0 ? (
        <Link href="/groups" className="text-destructive underline underline-offset-4">
          {t('groupConflict', { count: groupConflict })}
        </Link>
      ) : null}
    </div>
  );
}
