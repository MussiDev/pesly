import { CircleAlert, Clock, GitCompareArrows } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SyncState } from '../../sync-overlay';

const MARKERS = {
  pending: { Icon: Clock, tone: 'text-muted-foreground' },
  failed: { Icon: CircleAlert, tone: 'text-destructive' },
  conflict: { Icon: GitCompareArrows, tone: 'text-warning' },
} as const;

/** Where a record stands against the server; an icon and its text, never colour alone (FR-04). */
export function SyncMarker({ state }: { state: SyncState }) {
  const t = useTranslations('groups.edit.common.sync');
  if (state === 'synced') return null;
  const { Icon, tone } = MARKERS[state];
  return (
    <span className={`inline-flex items-center gap-1 text-small font-medium ${tone}`}>
      <Icon aria-hidden className="size-4" />
      {t(state)}
    </span>
  );
}
