'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type CategoriesLoadState = { kind: 'loading' } | { kind: 'failed'; error: ErrorMessageKey };

/** The list while it loads, or why it could not load (offline included) with a retry. */
export function CategoriesLoadStateView({
  state,
  onRetry,
}: {
  state: CategoriesLoadState;
  onRetry: () => void;
}) {
  const t = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');

  if (state.kind === 'loading') {
    // Same frame as the loaded screen: the new-category card, then the list rows.
    return (
      <div className="grid gap-6">
        <p role="status" className="sr-only">
          {t('loading')}
        </p>
        <Skeleton className="h-64 rounded-card" />
        <div className="grid gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
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
