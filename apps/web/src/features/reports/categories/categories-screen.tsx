'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { CategoryPie } from '@/components/ui/category-pie';
import { formatMoney } from '@/lib/format-amount';
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
import type { CategoriesView } from '../report-view';
import type { ReportState } from '../use-report';
import { CategoriesSkeleton } from './categories-skeleton';

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
        <ReportNotices
          unconvertedShares={view.unconvertedShareCount}
          unconvertedInstallments={view.unconvertedInstallmentCount}
          filtered={filtered}
        />
      );
      if (view.total <= 0n) {
        body = (
          <>
            {notices}
            <ReportEmpty from={view.from} to={view.to} onWiden={onWiden} />
          </>
        );
        break;
      }
      const total = formatMoney(view.total, view.currency, locale);
      body = (
        <>
          <ReportPeriod from={view.from} to={view.to} currency={view.currency} />
          {notices}
          <div className="grid gap-4 rounded-card bg-card p-4">
            <div className="grid gap-0.5">
              <p className="text-caption text-muted-foreground">{t('categories.total')}</p>
              <p className="text-display font-bold break-words tabular-nums">{total}</p>
            </div>
            <CategoryPie
              label={t('categories.listName')}
              segments={view.rows.map((row) => ({
                key: row.key,
                label: row.label,
                amounts: [formatMoney(row.amount, view.currency, locale)],
                // A share under 1% still gets a sliver, so the ring matches the "<1%" beside it.
                basisPoints: row.underOne ? 25 : row.percent * 100,
                color: row.color,
              }))}
              formatPercent={(basisPoints) =>
                basisPoints < 100
                  ? t('categories.underOne')
                  : t('categories.percent', { percent: basisPoints / 100 })
              }
              centre={
                <>
                  <span className="text-caption text-muted-foreground">
                    {t('categories.centre')}
                  </span>
                  <span className="text-caption font-bold tabular-nums">{total}</span>
                </>
              }
            />
          </div>
          <ReportFootnote cardPurchases />
        </>
      );
      break;
    }
  }

  return (
    <section aria-label={t('categories.title')} className="grid gap-4">
      <h2 className="sr-only">{t('categories.title')}</h2>
      {filters}
      {body}
    </section>
  );
}
