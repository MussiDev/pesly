'use client';

import { formatMinorUnits, type GoalResponse } from '@pesly/shared';
import { Target } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { GroupsLoadStateView } from '@/features/groups/components/groups-load-state';
import { Link, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { goalFailureKey } from '../helpers/goal-failure';
import { buildUpdateGoal, type GoalFormState } from '../helpers/goal-request';
import { formFailureMessage } from './form-failure';
import { GoalForm, type GoalFormErrors } from './goal-form';
import { GoalReadOnlyFields, GoalSavedSummary } from './goal-read-only-fields';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: 'network' | 'unexpected' }
  | { kind: 'not-found' }
  | { kind: 'ready'; goal: GoalResponse };

const goalIdSchema = z.uuid();

function NotFound() {
  const t = useTranslations('goals.detail.notFound');
  return (
    <EmptyState
      icon={<Target aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/goals" className={buttonVariants()}>
          {t('back')}
        </Link>
      }
    />
  );
}

/** The edit goal screen: name, target amount and date change; currency and link are fixed. */
export function EditGoalContainer({ goalId }: { goalId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const sending = useRef(false);
  const validId = goalIdSchema.safeParse(goalId).success;
  const [state, setState] = useState<LoadState>(
    validId ? { kind: 'loading' } : { kind: 'not-found' },
  );
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [saved, setSaved] = useState<GoalResponse | undefined>();

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const result = await api.getGoal(goalId);
    if (result.ok) {
      setState({ kind: 'ready', goal: result.data });
      return;
    }
    if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
      return;
    }
    const key = goalFailureKey(result);
    if (key.kind === 'not-found') setState({ kind: 'not-found' });
    else setState({ kind: 'failed', error: key.kind === 'offline' ? 'network' : 'unexpected' });
  }, [api, goalId, router]);

  useEffect(() => {
    if (validId) void load();
  }, [load, validId]);

  async function save(goal: GoalResponse, form: GoalFormState) {
    if (sending.current) return;
    const built = buildUpdateGoal(form, goal, locale);
    if (built.errors) {
      setErrors({ fields: built.errors });
      return;
    }
    setErrors({});
    if (built.unchanged) {
      setSaved(goal);
      return;
    }
    sending.current = true;
    setPending(true);
    const result = await api.updateGoal(goalId, built.request);
    sending.current = false;
    setPending(false);
    if (result.ok) {
      setState({ kind: 'ready', goal: result.data });
      setSaved(result.data);
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else if (goalFailureKey(result).kind === 'not-found') {
      setState({ kind: 'not-found' });
    } else {
      setSaved(undefined);
      setErrors({ form: formFailureMessage(result) });
    }
  }

  if (state.kind === 'not-found') return <NotFound />;
  if (state.kind === 'loading' || state.kind === 'failed') {
    return (
      <GroupsLoadStateView
        state={state.kind === 'loading' ? state : { kind: 'failed', error: state.error }}
        onRetry={() => {
          void load();
        }}
      />
    );
  }

  const { goal } = state;
  return (
    <div className="grid gap-4">
      <GoalForm
        mode="edit"
        initial={{
          name: goal.name,
          targetAmount: formatMinorUnits(BigInt(goal.targetAmount), locale === 'en' ? 'en' : 'es'),
          targetDate: goal.targetDate ?? '',
        }}
        readOnly={<GoalReadOnlyFields goal={goal} />}
        pending={pending}
        errors={errors}
        cancelHref={`/goals/${encodeURIComponent(goalId)}`}
        onSubmit={(form) => {
          void save(goal, form);
        }}
      />
      {saved ? <GoalSavedSummary goal={saved} /> : null}
    </div>
  );
}
