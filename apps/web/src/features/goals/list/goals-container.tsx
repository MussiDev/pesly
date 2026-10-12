'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { goalFailureKey, type GoalFailureKey } from '../helpers/goal-failure';
import { toGoalView, type GoalView } from '../helpers/goal-view';
import { GoalsHeader, GoalsList } from './goals-list';

type ListState =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: GoalFailureKey }
  | { kind: 'ready'; goals: GoalView[] };

/** Loads the user's goals in one request (FR-01). */
export function GoalsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('goals.list');
  const tApp = useTranslations('app');
  const tRoot = useTranslations();
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    void api.listGoals().then((result) => {
      if (!active) return;
      if (result.ok) setState({ kind: 'ready', goals: result.data.goals.map(toGoalView) });
      else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setState({ kind: 'failed', failure: goalFailureKey(result) });
    });
    return () => {
      active = false;
    };
  }, [api, router, request]);

  if (state.kind === 'ready') return <GoalsList goals={state.goals} />;

  if (state.kind === 'loading') {
    return (
      <div role="status" aria-busy="true" className="grid gap-3">
        <span className="sr-only">{tApp('loading')}</span>
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const description = state.failure.kind === 'not-found' ? undefined : tRoot(state.failure.key);
  return (
    <div className="grid gap-6">
      <GoalsHeader />
      <ErrorState
        title={t('error')}
        description={description}
        retryLabel={t('retry')}
        onRetry={() => {
          setState({ kind: 'loading' });
          setRequest((current) => current + 1);
        }}
      />
    </div>
  );
}
