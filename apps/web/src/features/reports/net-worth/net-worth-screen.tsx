'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { ReportFootnote, ReportPeriod } from '../components/report-meta';
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
  const withTotal = points.filter((point) => point.total !== null);
  const latest = withTotal.at(-1);
  const missingRate = points.some((point) => point.total === null);
  const selected = points.find((point) => point.date === selectedDate && point.total !== null);

  return (
    <>
      <ReportPeriod from={data.from} to={data.to} currency={data.currency} />
      {latest === undefined || latest.total === null ? (
        <Alert role="status" variant="info">
          <AlertDescription>{t('conversionUnavailable')}</AlertDescription>
        </Alert>
      ) : (
        <section
          aria-label={t('latest', { date: formatCalendarDate(latest.date, locale) })}
          className="grid gap-3 rounded-card bg-card p-4"
        >
          <div className="grid gap-0.5">
            <p className="text-caption text-muted-foreground">
              {t('latest', { date: formatCalendarDate(latest.date, locale) })}
            </p>
            <p className="text-display font-bold break-words tabular-nums">
              {formatMoney(latest.total, data.currency, locale)}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div className="grid min-w-0 gap-0.5">
              <dt className="text-caption text-muted-foreground">{t('ars')}</dt>
              <dd className="text-small font-semibold break-words tabular-nums">
                {formatMoney(latest.ars, 'ARS', locale)}
              </dd>
            </div>
            <div className="grid min-w-0 gap-0.5">
              <dt className="text-caption text-muted-foreground">{t('usd')}</dt>
              <dd className="text-small font-semibold break-words tabular-nums">
                {formatMoney(latest.usd, 'USD', locale)}
              </dd>
            </div>
          </dl>
          {latest.incomplete ? (
            <p className="text-caption text-muted-foreground">{t('investmentsIncomplete')}</p>
          ) : null}
        </section>
      )}
      {/* One month with a total is a dot, not a line: the chart waits for two. */}
      {withTotal.length >= 2 ? (
        <div className="rounded-card bg-card p-4">
          <NetWorthAreaChart
            locale={locale}
            currency={data.currency}
            points={points}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            from={data.from}
            to={data.to}
          />
        </div>
      ) : null}
      {selected === undefined ? null : (
        <NetWorthDetail locale={locale} currency={data.currency} point={selected} />
      )}
      <section aria-labelledby="net-worth-history" className="grid gap-2">
        <h3
          id="net-worth-history"
          className="text-caption font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {t('history')}
        </h3>
        {missingRate && withTotal.length > 0 ? (
          <p className="text-caption text-muted-foreground">{t('noRateOnce')}</p>
        ) : null}
        <ul aria-label={t('listName')} className="grid divide-y divide-border rounded-card bg-card">
          {[...points].reverse().map((point) => (
            <li key={point.date} className="grid gap-0.5 px-4 py-3">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-small font-semibold">
                  {formatCalendarDate(point.date, locale)}
                </span>
                <span className="text-small font-semibold tabular-nums">
                  {point.total === null ? '' : formatMoney(point.total, data.currency, locale)}
                </span>
              </span>
              <span className="text-caption text-muted-foreground tabular-nums">
                {formatMoney(point.ars, 'ARS', locale)} · {formatMoney(point.usd, 'USD', locale)}
                {point.incomplete ? ` · ${t('investmentsIncomplete')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <ReportFootnote />
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
      <h2 className="sr-only">{t('title')}</h2>
      <ReportFilters
        kind="netWorth"
        filters={filters}
        accounts={[]}
        today={today}
        onChange={onFiltersChange}
        serverField={
          state.status === 'badRange' && state.reason === 'server' ? state.field : undefined
        }
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
      {state.status === 'badRange' && state.reason === 'server' ? <RangeAlert /> : null}
      {state.status === 'ready' && state.data.points.length === 0 ? (
        <ReportEmpty from={state.data.from} to={state.data.to} onWiden={onWiden} />
      ) : null}
      {state.status === 'ready' && state.data.points.length > 0 ? (
        <NetWorthReady locale={locale} data={state.data} />
      ) : null}
    </div>
  );
}
