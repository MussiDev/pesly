'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { cn } from '@/lib/utils';
import { ChartFigure } from '../components/figures-list';
import { ReportFootnote, ReportPeriod } from '../components/report-meta';
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
import { MAX_DRAWN_MONTHS, MonthBars, MonthBarsLegend } from './month-bars';
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

/** One tile of the totals grid, as NorteAR's report figures. */
function Figure({
  label,
  tone,
  className,
  children,
}: {
  label: string;
  tone?: 'income' | 'expense' | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1 p-4', className)}>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-body font-bold wrap-anywhere tabular-nums',
          tone === 'income' && 'text-income',
          tone === 'expense' && 'text-expense',
        )}
      >
        {children}
      </dd>
    </div>
  );
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
        const active = months.filter((month) => month.income !== 0n || month.expenses !== 0n);
        if (active.length === 0) {
          return (
            <>
              {notices}
              <ReportEmpty from={view.from} to={view.to} onWiden={onWiden} />
            </>
          );
        }
        const income = months.reduce((sum, month) => sum + month.income, 0n);
        const expenses = months.reduce((sum, month) => sum + month.expenses, 0n);
        const net = income - expenses;
        const quiet = months.length - active.length;
        return (
          <>
            <ReportPeriod from={view.from} to={view.to} currency={view.currency} />
            {notices}
            <dl className="grid grid-cols-2 overflow-hidden rounded-card bg-card wrap-anywhere text-card-foreground">
              <Figure label={t('incomeExpenses.income')}>
                {formatMoney(income, view.currency, locale)}
              </Figure>
              <Figure label={t('incomeExpenses.expenses')} className="border-l border-border">
                {formatMoney(expenses, view.currency, locale)}
              </Figure>
              <Figure
                label={t('incomeExpenses.net')}
                className="border-t border-border"
                tone={net > 0n ? 'income' : net < 0n ? 'expense' : undefined}
              >
                {signedMoney(net, view.currency, locale)}
              </Figure>
              <Figure
                label={t('incomeExpenses.savings')}
                className="border-t border-l border-border"
                tone={net > 0n ? 'income' : net < 0n ? 'expense' : undefined}
              >
                {income > 0n
                  ? t('incomeExpenses.savingsPercent', {
                      percent: format.number((net * 100n) / income),
                    })
                  : t('incomeExpenses.savingsNone')}
              </Figure>
            </dl>
            <section aria-labelledby="income-expenses-chart" className="grid gap-2">
              <h3
                id="income-expenses-chart"
                className="text-caption font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t('incomeExpenses.chartTitle')}
              </h3>
              <div className="grid gap-3 rounded-card bg-card p-4">
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
                <MonthBarsLegend />
              </div>
            </section>
            <section aria-labelledby="income-expenses-months" className="grid gap-2">
              <h3
                id="income-expenses-months"
                className="text-caption font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t('incomeExpenses.listName')}
              </h3>
              <ul
                aria-label={t('incomeExpenses.listName')}
                className="grid divide-y divide-border rounded-card bg-card"
              >
                {[...active].reverse().map((month) => (
                  <li key={month.month} className="grid gap-0.5 px-4 py-3">
                    <span className="flex items-baseline justify-between gap-3 wrap-anywhere">
                      <span className="text-small font-semibold first-letter:uppercase">
                        {format.dateTime(new Date(`${month.month}-01T00:00:00Z`), {
                          month: 'long',
                          year: 'numeric',
                          timeZone: 'UTC',
                        })}
                      </span>
                      <span
                        className={cn(
                          'text-small font-semibold tabular-nums',
                          month.net > 0n && 'text-income',
                          month.net < 0n && 'text-expense',
                        )}
                      >
                        {signedMoney(month.net, view.currency, locale)}
                      </span>
                    </span>
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {t('incomeExpenses.income')}{' '}
                      {formatMoney(month.income, view.currency, locale)} ·{' '}
                      {t('incomeExpenses.expenses')}{' '}
                      {formatMoney(month.expenses, view.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
              {quiet > 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t('incomeExpenses.quietMonths', { count: quiet })}
                </p>
              ) : null}
            </section>
            <ReportFootnote cardPurchases />
          </>
        );
      }
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <h2 className="sr-only">{t('incomeExpenses.title')}</h2>
      {filters}
      {body()}
    </div>
  );
}
