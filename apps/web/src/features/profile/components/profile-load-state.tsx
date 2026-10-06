'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type ProfileLoadState = { kind: 'loading' } | { kind: 'failed'; error: ErrorMessageKey };

/** `cards` is how many cards the loaded screen has, so the skeleton fills the same space. */
export function ProfileLoadStateView({
  state,
  cards,
  onRetry,
}: {
  state: ProfileLoadState;
  cards: number;
  onRetry: () => void;
}) {
  const t = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');

  if (state.kind === 'loading') {
    return (
      <div role="status" aria-busy="true" className="grid gap-4">
        <span className="sr-only">{t('loading')}</span>
        {Array.from({ length: cards }, (_, index) => (
          <Skeleton key={index} className="h-64 rounded-card" />
        ))}
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
