'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { TagInputContainer } from '@/features/movements/containers/tag-input-container';
import type { Locale } from '@/i18n/routing';
import { useApiClient } from '@/lib/api-client-provider';
import { isOffline } from '@/lib/connectivity';
import { ReportFilters } from '../components/report-filters';
import { loadAccountOptions, type ReportAccountOption } from '../load-account-options';
import { toCategoriesView } from '../report-adapters';
import type { CategoriesView } from '../report-view';
import { useReport, type ReportState } from '../use-report';
import { useReportContext } from '../use-report-context';
import { useReportFilters } from '../use-report-filters';
import { CategoriesScreen } from './categories-screen';

/** Wires the address filters, the request and the account list to the presentational screen. */
export function CategoriesContainer() {
  const t = useTranslations('reports');
  const locale = useLocale() as Locale;
  const api = useApiClient();
  const { filters, setFilters, clearEntityFilters } = useReportFilters('categories');
  const { today } = useReportContext();
  const [accounts, setAccounts] = useState<ReportAccountOption[]>([]);

  useEffect(() => {
    if (isOffline()) return;
    let active = true;
    void loadAccountOptions(api, (name) => t('filters.archivedAccount', { name })).then(
      (options) => {
        if (active) setAccounts(options);
      },
    );
    return () => {
      active = false;
    };
  }, [api, t]);

  const { state, retry } = useReport({
    kind: 'categories',
    filters,
    today,
    load: () =>
      api.getExpensesByCategory({
        from: filters.from,
        to: filters.to,
        accountId: filters.accountId,
        tag: filters.tag,
      }),
  });

  const groupShares = t('categories.groupShares');
  const unnamed = t('categories.unnamed');
  const screenState = useMemo<ReportState<CategoriesView>>(
    () =>
      state.status === 'ready'
        ? { status: 'ready', data: toCategoriesView(state.data, locale, { groupShares, unnamed }) }
        : state,
    [state, locale, groupShares, unnamed],
  );

  return (
    <CategoriesScreen
      locale={locale}
      state={screenState}
      filtered={filters.accountId !== undefined || filters.tag !== undefined}
      onRetry={retry}
      onWiden={() => {
        setFilters({ ...filters, from: undefined, to: undefined });
      }}
      onReload={clearEntityFilters}
      filters={
        <ReportFilters
          kind="categories"
          filters={filters}
          accounts={accounts}
          today={today}
          onChange={setFilters}
          renderTagField={({ value, onChange }) => (
            <TagInputContainer value={value} onChange={onChange} />
          )}
        />
      }
    />
  );
}
