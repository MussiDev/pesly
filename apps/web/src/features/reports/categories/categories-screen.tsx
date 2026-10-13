'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { CurrencyNote } from '../components/currency-note';
import { ChartFigure, FiguresList } from '../components/figures-list';
import { CardPurchasesNote } from '@/components/card-purchases-note';
import { ReportNotices } from '../components/report-notices';
import {
  FilterGoneAlert,
  RangeAlert,
  ReportEmpty,
  ReportError,
  ReportLoading,
  ReportOffline,
} from '../components/report-states';
import type { CategoriesView } from '../report-view';
import { ringSegments } from '../shares';
import type { ReportState } from '../use-report';
import { CategoriesSkeleton } from './categories-skeleton';
import { CategoryRing } from './category-ring';

export interface CategoriesScreenProps {
  locale: Locale;
  state: ReportState<CategoriesView>;
  /** The filter bar, rendered by the container. */
  filters: ReactNode;
  /** An account or tag filter is active. */
  filtered: boolean;
  onRetry: () => void;
  /** Clears the dates. */
  onWiden: () => void;
  /** Clears the account and tag filters. */
  onReload: () => void;
}

/** Presentational: everything arrives as props; nothing is fetched here. */
export function CategoriesScreen({
  locale,
  state,
  filters,
  filtered,
  onRetry,
  onWiden,
  onReload,
}: CategoriesScreenProps) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const percentText = (percent: number, underOne: boolean) =>
    underOne ? t('categories.underOne') : t('categories.percent', { percent });

  let body: ReactNode = null;
  switch (state.status) {
    case 'loading':
      body = (
        <ReportLoading>
          <CategoriesSkeleton />
        </ReportLoading>
      );
      break;
    case 'failed':
      body = <ReportError retrying={state.retrying} onRetry={onRetry} />;
      break;
    case 'offline':
      body = <ReportOffline onRetry={onRetry} />;
      break;
    case 'filterGone':
      body = <FilterGoneAlert onReload={onReload} />;
      break;
    case 'badRange':
      // A local range problem is already worded next to the date fields.
      body = state.reason === 'server' ? <RangeAlert /> : null;
      break;
    case 'ready': {
      const view = state.data;
      const notices = (
        <>
          <ReportNotices
            unconvertedShares={view.unconvertedShareCount}
            unconvertedInstallments={view.unconvertedInstallmentCount}
            filtered={filtered}
          />
          <CardPurchasesNote />
        </>
      );
      if (view.total <= 0n) {
        body = (
          <>
            <CurrencyNote currency={view.currency} />
            {notices}
            <ReportEmpty from={view.from} to={view.to} onWiden={onWiden} />
          </>
        );
        break;
      }
      const total = formatMoney(view.total, view.currency, locale);
      const segments = ringSegments(view.rows, t('categories.other'));
      body = (
        <>
          <CurrencyNote currency={view.currency} />
          <p className="text-small text-muted-foreground">
            {t('range.resolved', { from: day(view.from), to: day(view.to) })}
          </p>
          {notices}
          <div className="grid gap-1">
            <p className="text-small text-muted-foreground">{t('categories.total')}</p>
            <p className="text-display font-semibold tabular-nums [overflow-wrap:anywhere]">
              {total}
            </p>
          </div>
          <ChartFigure
            name={t('categories.chartName')}
            summary={t('categories.chartSummary', {
              from: day(view.from),
              to: day(view.to),
              total,
            })}
          >
            <CategoryRing
              label={t('categories.chartName')}
              segments={segments}
              rows={view.rows}
              total={view.total}
              percentText={percentText}
            />
          </ChartFigure>
          <FiguresList
            label={t('categories.listName')}
            rows={view.rows.map((row) => ({
              key: row.key,
              label: row.label,
              value: formatMoney(row.amount, view.currency, locale),
              note: percentText(row.percent, row.underOne),
            }))}
          />
        </>
      );
      break;
    }
  }

  return (
    <section aria-label={t('categories.title')} className="grid gap-4">
      <h2 className="text-h2 font-semibold">{t('categories.title')}</h2>
      {filters}
      {body}
    </section>
  );
}
