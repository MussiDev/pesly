'use client';

import { formatMinorUnits, type BudgetResponse } from '@pesly/shared';
import { Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { GroupsLoadStateView } from '@/features/groups/components/groups-load-state';
import { Link, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { budgetFailureKey } from '../helpers/budget-failure';
import { buildUpdateBudget, type BudgetFormState } from '../helpers/budget-request';
import { BudgetForm, type BudgetFormErrors } from './budget-form';
import { BudgetReadOnlyFields, BudgetSavedSummary } from './budget-read-only-fields';
import { formFailureMessage } from './form-failure';
import { useBudgetCategories } from './use-budget-categories';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: 'network' | 'unexpected' }
  | { kind: 'not-found' }
  | { kind: 'ready'; budget: BudgetResponse };

const budgetIdSchema = z.uuid();

function NotFound() {
  const t = useTranslations('budgets.detail.notFound');
  return (
    <EmptyState
      icon={<Wallet aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/budgets" className={buttonVariants()}>
          {t('back')}
        </Link>
      }
    />
  );
}

function formState(budget: BudgetResponse, locale: string): BudgetFormState {
  return {
    name: budget.name,
    amount: formatMinorUnits(BigInt(budget.amount), locale === 'en' ? 'en' : 'es'),
    currency: budget.currency,
    categoryIds: [...budget.categoryIds],
    rollover: budget.rollover,
    thresholds: [...budget.thresholds],
  };
}

/** The edit budget screen: two requests to load (budget, categories), one to save. */
export function EditBudgetContainer({ budgetId }: { budgetId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const sending = useRef(false);
  const validId = budgetIdSchema.safeParse(budgetId).success;
  const categories = useBudgetCategories(validId);
  const [state, setState] = useState<LoadState>(
    validId ? { kind: 'loading' } : { kind: 'not-found' },
  );
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<BudgetFormErrors>({});
  const [saved, setSaved] = useState<BudgetResponse | undefined>();

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const result = await api.getBudget(budgetId);
    if (result.ok) {
      setState({ kind: 'ready', budget: result.data });
      return;
    }
    if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
      return;
    }
    const key = budgetFailureKey(result);
    if (key.kind === 'not-found') setState({ kind: 'not-found' });
    else setState({ kind: 'failed', error: key.kind === 'offline' ? 'network' : 'unexpected' });
  }, [api, budgetId, router]);

  useEffect(() => {
    if (validId) void load();
  }, [load, validId]);

  async function save(budget: BudgetResponse, form: BudgetFormState) {
    if (sending.current) return;
    const built = buildUpdateBudget(form, budget, locale);
    if (built.errors) {
      setErrors({ fields: built.errors });
      return;
    }
    setErrors({});
    if (built.unchanged) return;
    sending.current = true;
    setPending(true);
    const result = await api.updateBudget(budgetId, built.request);
    sending.current = false;
    setPending(false);
    if (result.ok) {
      setState({ kind: 'ready', budget: result.data });
      setSaved(result.data);
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else if (budgetFailureKey(result).kind === 'not-found') {
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

  const { budget } = state;
  return (
    <div className="grid gap-4">
      <BudgetForm
        mode="edit"
        initial={formState(budget, locale)}
        readOnly={<BudgetReadOnlyFields budget={budget} />}
        categories={categories.state}
        onRetryCategories={categories.retry}
        pending={pending}
        errors={errors}
        cancelHref={`/budgets/${encodeURIComponent(budgetId)}`}
        isUnchanged={(form) => buildUpdateBudget(form, budget, locale).unchanged === true}
        onSubmit={(form) => {
          void save(budget, form);
        }}
      />
      {saved ? <BudgetSavedSummary budget={saved} /> : null}
    </div>
  );
}
