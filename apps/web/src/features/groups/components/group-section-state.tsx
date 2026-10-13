import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';

export type SectionStatus = 'loading' | 'failed' | 'ready';

/** Fewer than the 5 rows of the longest section, so a loading section never outgrows a loaded one. */
const SKELETON_ROWS = 3;

interface GroupSectionStateProps {
  status: SectionStatus;
  onRetry: () => void;
  /** Rendered only when the section is ready. */
  children: ReactNode;
}

/** What one section of the group detail shows while it loads or after it failed to load. */
export function GroupSectionState({ status, onRetry, children }: GroupSectionStateProps) {
  const t = useTranslations('groups.detail');
  const tApp = useTranslations('app');

  if (status === 'loading') {
    return (
      <div className="grid gap-2" aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-12" />
        ))}
      </div>
    );
  }

  if (status === 'failed') {
    return <ErrorState title={t('sectionFailed')} retryLabel={tApp('retry')} onRetry={onRetry} />;
  }

  return children;
}
