'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type CreditCardsLoadState = { kind: 'loading' } | { kind: 'failed'; error: ErrorMessageKey };

/** The cards while they load, or why they could not load, with a retry. */
export function CreditCardsLoadStateView({
  state,
  onRetry,
}: {
  state: CreditCardsLoadState;
  onRetry: () => void;
}) {
  const t = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');

  if (state.kind === 'loading') {
    return (
      <div role="status" aria-busy="true" className="grid gap-3">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
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
