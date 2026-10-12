'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { CurrencyNote } from '../components/currency-note';
import { FiguresList, type FigureRow } from '../components/figures-list';
import { ReportFilters } from '../components/report-filters';
import {
  RangeAlert,
  ReportEmpty,
  ReportError,
  ReportLoading,
  ReportOffline,
} from '../components/report-states';
import type { ReportFilterValues } from '../report-filters-state';
import type { NetWorthView } from '../report-view';
import type { ReportState } from '../use-report';
import { NetWorthAreaChart } from './net-worth-area-chart';
import { NetWorthDetail } from './net-worth-detail';
import { NetWorthSkeleton } from './net-worth-skeleton';

/** A series longer than this draws its last months only. */
const MAX_POINTS = 24;

export interface NetWorthScreenProps {
  locale: Locale;
  state: ReportState<NetWorthView>;
  filters: ReportFilterValues;
  today: string | undefined;
  onFiltersChange: (next: ReportFilterValues) => void;
  onRetry: () => void;
  /** Clears the dates. */
  onWiden: () => void;
}

function NetWorthReady({ locale, data }: { locale: Locale; data: NetWorthView }) {
  const t = useTranslations('reports.netWorth');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const points = data.points.slice(-MAX_POINTS);
  const anyTotal = points.some((point) => point.total !== null);
  const selected = points.find((point) => point.date === selectedDate && point.total !== null);

  const rows: FigureRow[] = points.map((point) => {
    const parts = `${formatMoney(point.ars, 'ARS', locale)} · ${formatMoney(point.usd, 'USD', locale)}`;
    const base = { key: point.date, label: formatCalendarDate(point.date, locale) };
    if (point.total === null) return { ...base, value: parts, note: t('noRate') };
    return {
      ...base,
      value: formatMoney(point.total, data.currency, locale),
      note: point.incomplete ? `${parts} · ${t('investmentsIncomplete')}` : parts,
    };
  });

  return (
    <>
      <CurrencyNote currency={data.currency} />
      {anyTotal ? (
        <>
          <NetWorthAreaChart
            locale={locale}
            currency={data.currency}
            points={points}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            from={data.from}
            to={data.to}
          />
          {selected === undefined ? null : (
            <NetWorthDetail locale={locale} currency={data.currency} point={selected} />
          )}
        </>
      ) : (
        <Alert role="status" variant="info">
          <AlertDescription>{t('conversionUnavailable')}</AlertDescription>
        </Alert>
      )}
      <FiguresList label={t('listName')} rows={rows} />
    </>
  );
}

/** The net worth report: range filter, currency note, chart and detail, and the text list. */
export function NetWorthScreen({
  locale,
  state,
  filters,
  today,
  onFiltersChange,
  onRetry,
  onWiden,
}: NetWorthScreenProps) {
  const t = useTranslations('reports.netWorth');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <ReportFilters
        kind="netWorth"
        filters={filters}
        accounts={[]}
        today={today}
        onChange={onFiltersChange}
      />
      {state.status === 'loading' ? (
        <ReportLoading>
          <NetWorthSkeleton />
        </ReportLoading>
      ) : null}
      {state.status === 'failed' ? (
        <ReportError retrying={state.retrying} onRetry={onRetry} />
      ) : null}
      {state.status === 'filterGone' ? <ReportError retrying={false} onRetry={onRetry} /> : null}
      {state.status === 'offline' ? <ReportOffline onRetry={onRetry} /> : null}
      {state.status === 'badRange' ? <RangeAlert /> : null}
      {state.status === 'ready' && state.data.points.length === 0 ? (
        <ReportEmpty from={state.data.from} to={state.data.to} onWiden={onWiden} />
      ) : null}
      {state.status === 'ready' && state.data.points.length > 0 ? (
        <NetWorthReady locale={locale} data={state.data} />
      ) : null}
    </div>
  );
}
