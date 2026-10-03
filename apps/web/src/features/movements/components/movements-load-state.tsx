'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ui/error-state';
import { listRowVariants } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type MovementsLoadState = { kind: 'loading' } | { kind: 'failed'; error: ErrorMessageKey };

/** The list while it loads, or why it could not load (offline included) with a retry. */
export function MovementsLoadStateView({
  state,
  onRetry,
}: {
  state: MovementsLoadState;
  onRetry: () => void;
}) {
  const t = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');

  if (state.kind === 'loading') {
    // Same blocks as the loaded view (a day heading, then its rows), so nothing jumps when data lands.
    return (
      <div role="status" aria-busy="true" className="grid gap-4">
        <span className="sr-only">{t('loading')}</span>
        <div className="grid gap-1">
          <Skeleton className="h-5 w-1/2" />
          <div className="divide-y divide-border rounded-xl border bg-card px-3">
            {[0, 1, 2].map((row) => (
              // The same classes as a real row (`ListRow`), so the swap keeps its height.
              <div key={row} data-skeleton-row className={listRowVariants()}>
                <Skeleton className="size-9 rounded-full" />
                <div className="grid flex-1 gap-1">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-5 w-1/3" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorState
      title={tUi('error.title')}
      description={tErrors(state.error)}
      retryLabel={t('retry')}
      onRetry={onRetry}
    />
  );
}
