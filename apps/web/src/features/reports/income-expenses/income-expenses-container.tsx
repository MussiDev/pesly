'use client';

import { useLocale } from 'next-intl';
import { useCallback } from 'react';
import { TagInputContainer } from '@/features/movements/containers/tag-input-container';
import type { Locale } from '@/i18n/routing';
import { useApiClient } from '@/lib/api-client-provider';
import { ReportFilters } from '../components/report-filters';
import { toIncomeExpensesView } from '../report-adapters';
import { hasEntityFilter, toReportQuery } from '../report-filters-state';
import { useAccountOptions } from '../use-account-options';
import { useReport } from '../use-report';
import { useReportContext } from '../use-report-context';
import { useReportFilters } from '../use-report-filters';
import { IncomeExpensesScreen } from './income-expenses-screen';

/** Wires the address, the request and the account list to the presentational screen. */
export function IncomeExpensesContainer() {
  const locale = useLocale() as Locale;
  const api = useApiClient();
  const { today } = useReportContext();
  const { filters, setFilters, clearEntityFilters } = useReportFilters('incomeExpenses');
  const accounts = useAccountOptions();

  const load = useCallback(
    () =>
      api
        .getIncomeExpenses(toReportQuery(filters))
        .then((result) =>
          result.ok ? { ok: true as const, data: toIncomeExpensesView(result.data) } : result,
        ),
    [api, filters],
  );

  const { state, retry } = useReport({ kind: 'incomeExpenses', filters, load, today });

  return (
    <IncomeExpensesScreen
      locale={locale}
      state={state}
      filtered={hasEntityFilter(filters)}
      onRetry={retry}
      onWiden={() => {
        setFilters({ accountId: filters.accountId, tag: filters.tag });
      }}
      onClearFilters={clearEntityFilters}
      filters={
        <ReportFilters
          kind="incomeExpenses"
          filters={filters}
          accounts={accounts}
          today={today}
          onChange={setFilters}
          serverField={
            state.status === 'badRange' && state.reason === 'server' ? state.field : undefined
          }
          renderTagField={({ value, onChange }) => (
            <TagInputContainer value={value} onChange={onChange} />
          )}
        />
      }
    />
  );
}
