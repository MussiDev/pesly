'use client';

import { useLocale } from 'next-intl';
import { useCallback } from 'react';
import type { Locale } from '@/i18n/routing';
import { useApiClient } from '@/lib/api-client-provider';
import { toNetWorthView } from '../report-adapters';
import type { NetWorthView } from '../report-view';
import { useReport } from '../use-report';
import { useReportContext } from '../use-report-context';
import { useReportFilters } from '../use-report-filters';
import { NetWorthScreen } from './net-worth-screen';

/** Wires the address, the request and the screen; range only (net worth has no entity filters). */
export function NetWorthContainer() {
  const api = useApiClient();
  const locale = useLocale() as Locale;
  const { today } = useReportContext();
  const { filters, setFilters } = useReportFilters('netWorth');
  const { from, to } = filters;

  const load = useCallback(async () => {
    const result = await api.getNetWorthSeries({
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
    return result.ok ? { ok: true as const, data: toNetWorthView(result.data) } : result;
  }, [api, from, to]);

  const { state, retry } = useReport<NetWorthView>({ kind: 'netWorth', filters, load, today });

  return (
    <NetWorthScreen
      locale={locale}
      state={state}
      filters={filters}
      today={today}
      onFiltersChange={setFilters}
      onRetry={retry}
      onWiden={() => {
        setFilters({});
      }}
    />
  );
}
