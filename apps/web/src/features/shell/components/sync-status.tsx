'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface SyncStatusProps {
  /** Changes kept on this device that wait to be sent. */
  pending: number;
  /** Changes the server refused, waiting for the person. */
  failed: number;
}

/** How many changes are not on the server yet; nothing at all when there are none. */
export function SyncStatus({ pending, failed }: SyncStatusProps) {
  const t = useTranslations('app.sync');
  if (pending === 0 && failed === 0) return null;
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
    </div>
  );
}
