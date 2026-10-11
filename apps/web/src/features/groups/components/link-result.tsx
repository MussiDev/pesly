'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import type { LinkState } from '../use-group-link';

/** The state of opening an invitation (`join`) or claim (`claim`) link. */
export function LinkResult({
  kind,
  state,
  onRetry,
}: {
  kind: 'join' | 'claim';
  state: LinkState;
  onRetry: () => void;
}) {
  const t = useTranslations('groups.join');
  const tApp = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');

  if (state.kind === 'working') {
    return (
      <div role="status" aria-busy="true" className="grid gap-3">
        <span className="sr-only">{t(`${kind}.working`)}</span>
        <Skeleton className="h-16" />
      </div>
    );
  }

  const { reason } = state;
  if (reason === 'network') {
    return (
      <ErrorState
        title={tUi('error.title')}
        description={tErrors('network')}
        retryLabel={tApp('retry')}
        onRetry={onRetry}
      />
    );
  }

  const message = {
    invalid: t(`${kind}.invalid`),
    alreadyMember: t('alreadyMember'),
    full: t('full'),
    signIn: t('signIn'),
    unexpected: tErrors('unexpected'),
  }[reason];

  return (
    <div className="grid gap-4">
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Link href="/groups" className={buttonVariants({ variant: 'outline' })}>
        {t('backToGroups')}
      </Link>
    </div>
  );
}
