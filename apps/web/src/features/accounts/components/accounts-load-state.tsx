'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type AccountsLoadState = { kind: 'loading' } | { kind: 'failed'; error: ErrorMessageKey };

/** The list while it loads, or why it could not load (offline included) with a retry. */
export function AccountsLoadStateView({
  state,
  onRetry,
}: {
  state: AccountsLoadState;
  onRetry: () => void;
}) {
  const t = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');

  if (state.kind === 'loading') {
    // Same blocks as the loaded view (headline cards, then rows), so nothing jumps when data lands.
    return (
      <div role="status" aria-busy="true" className="grid gap-4">
        <span className="sr-only">{t('loading')}</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
        </div>
        <div className="grid gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
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
