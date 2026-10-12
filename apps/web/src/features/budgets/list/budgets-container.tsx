'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import {
  budgetFailureKey,
  isMonthInFuture,
  type BudgetFailureKey,
} from '../helpers/budget-failure';
import {
  canGoNext,
  canGoPrevious,
  initialMonthState,
  isMonthAfter,
  isValidMonth,
  nextMonth,
  previousMonth,
  selectMonth,
  type MonthState,
} from '../helpers/budget-month';
import { toBudgetView, type BudgetView } from '../helpers/budget-view';
import { BudgetsHeader, BudgetsList } from './budgets-list';
import { MonthSelector } from './month-selector';

type ListState =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: BudgetFailureKey }
  | { kind: 'ready'; budgets: BudgetView[] };

/**
 * Loads the spending list of the selected month in one request (FR-01). The first load sends no
 * month, so the API answers for the current month in the user's time zone (D4).
 */
export function BudgetsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('budgets.list');
  const tApp = useTranslations('app');
  const tRoot = useTranslations();
  const queryMonth = searchParams.get('month');

  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [months, setMonths] = useState<MonthState | null>(null);
  // `null` asks for the current month, with no month in the request.
  const [selection, setSelection] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const queryApplied = useRef(false);

  useEffect(() => {
    let active = true;
    void api.listBudgetSpending(selection === null ? {} : { month: selection }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (isMonthInFuture(result)) {
          setRefusal(`errors.${result.messageKey}`);
          setMonths((current) => (current ? selectMonth(current, current.current) : current));
          setState({ kind: 'loading' });
          setSelection(null);
        } else setState({ kind: 'failed', failure: budgetFailureKey(result) });
        return;
      }
      if (selection === null) {
        const current = result.data.month;
        setMonths(initialMonthState(current));
        // A month in the link is followed once, and only when it is an earlier one.
        if (
          !queryApplied.current &&
          queryMonth !== null &&
          isValidMonth(queryMonth) &&
          isMonthAfter(current, queryMonth)
        ) {
          queryApplied.current = true;
          setMonths(selectMonth(initialMonthState(current), queryMonth));
          setSelection(queryMonth);
          return;
        }
        queryApplied.current = true;
      }
      setState({ kind: 'ready', budgets: result.data.budgets.map(toBudgetView) });
    });
    return () => {
      active = false;
    };
  }, [api, router, selection, request, queryMonth]);

  function goTo(month: string) {
    if (!months) return;
    setRefusal(null);
    setState({ kind: 'loading' });
    setMonths(selectMonth(months, month));
    setSelection(month === months.current ? null : month);
    setRequest((value) => value + 1);
  }

  if (months === null && state.kind !== 'failed') {
    return (
      <div role="status" aria-busy="true" className="grid gap-3">
        <span className="sr-only">{tApp('loading')}</span>
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const previous = months ? previousMonth(months.selected) : null;
  const next = months ? nextMonth(months) : null;

  return (
    <div className="grid gap-6">
      <BudgetsHeader />
      {months ? (
        <MonthSelector
          month={months.selected}
          isCurrent={months.selected === months.current}
          canPrevious={canGoPrevious(months.selected)}
          canNext={canGoNext(months)}
          onPrevious={() => {
            if (previous) goTo(previous);
          }}
          onNext={() => {
            if (next) goTo(next);
          }}
        />
      ) : null}
      {refusal ? (
        <Alert variant="destructive">
          <AlertDescription>{tRoot(refusal)}</AlertDescription>
        </Alert>
      ) : null}
      {state.kind === 'ready' ? <BudgetsList budgets={state.budgets} /> : null}
      {state.kind === 'loading' ? (
        <div role="status" aria-busy="true" className="grid gap-3">
          <span className="sr-only">{tApp('loading')}</span>
          <Skeleton className="h-28" />
        </div>
      ) : null}
      {state.kind === 'failed' ? (
        <ErrorState
          title={t('error')}
          description={state.failure.kind === 'not-found' ? undefined : tRoot(state.failure.key)}
          retryLabel={t('retry')}
          onRetry={() => {
            setState({ kind: 'loading' });
            setRequest((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}
