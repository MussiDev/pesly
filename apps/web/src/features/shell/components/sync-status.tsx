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

// 44 px tall touch target (NFR-08).
const LINK = 'inline-flex min-h-11 items-center underline underline-offset-4';

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
      className="flex flex-wrap gap-x-3 px-4 pt-1 text-small text-muted-foreground"
    >
      {pending > 0 ? <span>{t('waiting', { count: pending })}</span> : null}
      {failed > 0 ? (
        <Link href="/movements" className={`${LINK} text-destructive`}>
          {t('failed', { count: failed })}
        </Link>
      ) : null}
      {groupWaiting > 0 ? (
        <Link href="/groups" className={LINK}>
          {t('groupWaiting', { count: groupWaiting })}
        </Link>
      ) : null}
      {groupFailed > 0 ? (
        <Link href="/groups" className={`${LINK} text-destructive`}>
          {t('groupFailed', { count: groupFailed })}
        </Link>
      ) : null}
      {groupConflict > 0 ? (
        <Link href="/groups" className={`${LINK} text-destructive`}>
          {t('groupConflict', { count: groupConflict })}
        </Link>
      ) : null}
    </div>
  );
}
