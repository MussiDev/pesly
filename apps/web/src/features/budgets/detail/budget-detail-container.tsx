'use client';

import type {
  BudgetResponse,
  BudgetSpendingResponse,
  CategoryLanguage,
  CategoryResponse,
} from '@pesly/shared';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  GroupsLoadStateView,
  type GroupsLoadState,
} from '@/features/groups/components/groups-load-state';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { budgetFailureKey, isMonthInFuture } from '../helpers/budget-failure';
import { isValidMonth } from '../helpers/budget-month';
import { toBudgetView } from '../helpers/budget-view';
import { coveredCategoryGroups } from './budget-categories';
import { BudgetDetailView } from './budget-detail-view';
import { BudgetNotFound } from './budget-not-found';

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | {
      kind: 'ready';
      budget: BudgetResponse;
      spending: BudgetSpendingResponse;
      categories: CategoryResponse[];
    };

const budgetIdSchema = z.uuid();

/**
 * One budget for a month. 3 requests (D5): the budget, its spending and the expense categories
 * that give the covered ones their names. The month comes from the route query; a malformed one
 * loads the current month, as does one the API refuses as a future month.
 */
export function BudgetDetailContainer({ budgetId }: { budgetId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const queryMonth = useSearchParams().get('month');
  const month = queryMonth !== null && isValidMonth(queryMonth) ? queryMonth : undefined;
  const validId = budgetIdSchema.safeParse(budgetId).success;
  const [state, setState] = useState<ScreenState>(
    validId ? { kind: 'loading' } : { kind: 'not-found' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!validId) return;
    const run = { active: true };
    const stale = () => !run.active;
    void (async () => {
      const [budget, firstSpending, categories] = await Promise.all([
        api.getBudget(budgetId),
        api.getBudgetSpending(budgetId, { month }),
        api.listCategories({ kind: 'expense', archived: false, limit: 100, offset: 0 }),
      ]);
      if (stale()) return;
      let spending = firstSpending;
      if (!spending.ok && isMonthInFuture(spending)) {
        spending = await api.getBudgetSpending(budgetId, {});
        if (stale()) return;
      }
      if (!budget.ok || !spending.ok || !categories.ok) {
        const failure = !budget.ok ? budget : !spending.ok ? spending : categories;
        if (failure.ok) return;
        if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (budgetFailureKey(failure).kind === 'not-found') setState({ kind: 'not-found' });
        else setState({ kind: 'failed', error: failure.messageKey });
        return;
      }
      setState({
        kind: 'ready',
        budget: budget.data,
        spending: spending.data,
        categories: categories.data.items,
      });
    })();
    return () => {
      run.active = false;
    };
  }, [api, budgetId, month, router, attempt, validId]);

  const ready = state.kind === 'ready' ? state : null;
  const groups = useMemo(
    () =>
      ready === null
        ? []
        : coveredCategoryGroups(ready.categories, ready.budget.categoryIds, language),
    [ready, language],
  );

  if (state.kind === 'not-found') return <BudgetNotFound />;

  if (state.kind !== 'ready') {
    return (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  return (
    <BudgetDetailView
      view={toBudgetView(state.spending)}
      groups={groups}
      onDeleted={() => {
        router.push('/budgets');
      }}
    />
  );
}
