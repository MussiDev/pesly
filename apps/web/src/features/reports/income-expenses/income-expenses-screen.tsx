'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { CurrencyNote } from '../components/currency-note';
import { ChartFigure, FiguresList, type FigureRow } from '../components/figures-list';
import { ReportNotices } from '../components/report-notices';
import {
  FilterGoneAlert,
  RangeAlert,
  ReportEmpty,
  ReportError,
  ReportLoading,
  ReportOffline,
} from '../components/report-states';
import type { IncomeExpensesView } from '../report-view';
import type { ReportState } from '../use-report';
import { IncomeExpensesSkeleton } from './income-expenses-skeleton';
import { MAX_DRAWN_MONTHS, MonthBars } from './month-bars';
import { signedMoney } from './signed-money';

export interface IncomeExpensesScreenProps {
  locale: Locale;
  /** The filter bar, supplied by the container. */
  filters: ReactNode;
  state: ReportState<IncomeExpensesView>;
  /** An account or tag filter is active. */
  filtered: boolean;
  onRetry: () => void;
  onWiden: () => void;
  onClearFilters: () => void;
}

/** Presentational: every state of the report, drawn from what it is given. */
export function IncomeExpensesScreen({
  locale,
  filters,
  state,
  filtered,
  onRetry,
  onWiden,
  onClearFilters,
}: IncomeExpensesScreenProps) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });

  function body() {
    switch (state.status) {
      case 'loading':
        return (
          <ReportLoading>
            <IncomeExpensesSkeleton />
          </ReportLoading>
        );
      case 'failed':
        return <ReportError retrying={state.retrying} onRetry={onRetry} />;
      case 'offline':
        return <ReportOffline onRetry={onRetry} />;
      case 'filterGone':
        return <FilterGoneAlert onReload={onClearFilters} />;
      case 'badRange':
        // A range refused locally is already explained next to the date fields.
        return state.reason === 'server' ? <RangeAlert /> : null;
      case 'ready': {
        const view = state.data;
        const months = view.months.slice(0, MAX_DRAWN_MONTHS);
        const notices = (
          <ReportNotices
            unconvertedShares={view.unconvertedShareCount}
            unconvertedInstallments={view.unconvertedInstallmentCount}
            filtered={filtered}
          />
        );
        if (months.every((month) => month.income === 0n && month.expenses === 0n)) {
          return (
            <>
              {notices}
              <ReportEmpty from={view.from} to={view.to} onWiden={onWiden} />
            </>
          );
        }
        const rows: FigureRow[] = months.map((month, index) => ({
          key: `${month.month}-${String(index)}`,
          label: format.dateTime(new Date(`${month.month}-01T00:00:00Z`), {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }),
          note: `${t('incomeExpenses.income')} ${formatMoney(month.income, view.currency, locale)} · ${t('incomeExpenses.expenses')} ${formatMoney(month.expenses, view.currency, locale)}`,
          value: signedMoney(month.net, view.currency, locale),
        }));
        return (
          <>
            <CurrencyNote currency={view.currency} />
            {notices}
            <p className="text-small text-muted-foreground">
              {t('range.resolved', { from: day(view.from), to: day(view.to) })}
            </p>
            <ChartFigure
              name={t('incomeExpenses.chartName')}
              summary={t('incomeExpenses.chartSummary', {
                from: day(view.from),
                to: day(view.to),
                months: months.length,
              })}
            >
              <MonthBars months={months} currency={view.currency} locale={locale} />
            </ChartFigure>
            <FiguresList label={t('incomeExpenses.listName')} rows={rows} />
          </>
        );
      }
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <h2 className="text-lg font-semibold">{t('incomeExpenses.title')}</h2>
      {filters}
      {body()}
    </div>
  );
}
