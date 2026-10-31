'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { drawnPoints } from '../chart/chart-geometry';
import { NetWorthChart } from '../chart/net-worth-chart';
import { NetWorthPointsList } from '../chart/net-worth-points-list';
import type { AvailableView, Currency, NetWorthView, SeriesPointView } from '../dashboard-view';
import { NetWorthNotice } from './net-worth-notice';
import { MoneyText } from '@/components/ui/money-text';

export type SeriesState =
  | { kind: 'ready'; currency: Currency; points: SeriesPointView[] }
  | { kind: 'failed'; retrying: boolean; onRetry: () => void };

/** One translucent tile on the navy card: the pesos and dollars parts sit side by side. */
const PART_CLASS =
  'grid min-w-0 flex-1 basis-32 content-start gap-0.5 rounded-xl bg-hero-foreground/10 px-3 py-2.5';

/** The small uppercase label of a figure on the navy card. */
const EYEBROW_CLASS = 'text-caption font-semibold tracking-wide text-hero-muted uppercase';

/** The net worth figure of record, its ARS and USD parts and the chart (or its retry). */
export function NetWorthCard({
  locale,
  currency,
  netWorth,
  available,
  series,
}: {
  locale: Locale;
  currency: Currency;
  netWorth: NetWorthView;
  available: AvailableView;
  series: SeriesState;
}) {
  const t = useTranslations('dashboard');
  // Amounts in another currency would be labeled with the wrong one, so that series is not shown.
  const showSeries = series.kind === 'ready' && series.currency === currency;
  const drawnCount = series.kind === 'ready' && showSeries ? drawnPoints(series.points).length : 0;
  // With no rate neither figure converts. Each figure keeps its own notice (AC-05, AC-21); the
  // chart, which could only say the same a third time, is left out (signal-to-noise).
  const noneConverted = netWorth.total === null && available.total === null;
  const chartShown = showSeries && !(noneConverted && drawnCount === 0);
  const reportLink = (
    <Link
      href="/reports/net-worth"
      className="inline-flex min-h-11 items-center self-start text-small font-medium text-primary underline-offset-4 hover:underline"
    >
      {t('netWorth.viewReport')}
    </Link>
  );

  return (
    <section aria-labelledby="net-worth-title" className="grid min-w-0 content-start gap-3">
      <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-5 rounded-card bg-hero px-5 pt-4.5 pb-5 text-hero-foreground">
        <FigureBlock
          locale={locale}
          currency={currency}
          title={
            <h2 id="net-worth-title" className={EYEBROW_CLASS}>
              {t('netWorth.label')}
            </h2>
          }
          total={netWorth.total}
          ars={netWorth.ars}
          usd={netWorth.usd}
          figureClass="text-display font-bold"
        />
        <FigureBlock
          locale={locale}
          currency={currency}
          groupLabelId="available-title"
          title={
            <h2 id="available-title" className={EYEBROW_CLASS}>
              {t('available.label')}
            </h2>
          }
          total={available.total}
          ars={available.ars}
          usd={available.usd}
          figureClass="text-title font-bold"
        />
      </div>
      {chartShown || series.kind === 'failed' || netWorth.holdingsWithoutPrice > 0 ? (
        <Card className="min-w-0">
          <CardContent className="flex min-w-0 flex-col gap-4">
            <NetWorthNotice count={netWorth.holdingsWithoutPrice} />
            {series.kind === 'ready' ? (
              chartShown ? (
                <>
                  <NetWorthChart locale={locale} currency={currency} points={series.points} />
                  {drawnCount > 0 ? (
                    <p className="text-caption text-muted-foreground">
                      {t('netWorth.lastPointNote')}
                    </p>
                  ) : null}
                  <NetWorthPointsList locale={locale} currency={currency} points={series.points} />
                </>
              ) : null
            ) : (
              <SeriesFailure retrying={series.retrying} onRetry={series.onRetry} />
            )}
            {reportLink}
          </CardContent>
        </Card>
      ) : (
        // Nothing to chart: the report link stands alone instead of in an empty card.
        reportLink
      )}
    </section>
  );
}

/** A label, its converted figure (or the notice) and the ARS and USD parts, on the navy card. */
function FigureBlock({
  locale,
  currency,
  title,
  total,
  ars,
  usd,
  figureClass,
  groupLabelId,
}: {
  locale: Locale;
  currency: Currency;
  title: ReactNode;
  total: bigint | null;
  ars: bigint;
  usd: bigint;
  figureClass: string;
  groupLabelId?: string;
}) {
  const t = useTranslations('dashboard');
  return (
    <div
      role={groupLabelId === undefined ? undefined : 'group'}
      aria-labelledby={groupLabelId}
      className="grid min-w-0 flex-1 basis-64 content-start gap-3"
    >
      <div className="grid min-w-0 gap-1">
        {title}
        {total === null ? (
          <p className="text-small text-hero-muted">{t('netWorth.conversionUnavailable')}</p>
        ) : (
          <p className={`min-w-0 break-words ${figureClass}`}>
            <MoneyText text={formatMoney(total, currency, locale)} />
          </p>
        )}
      </div>
      <dl className="flex min-w-0 flex-wrap gap-2">
        <div className={PART_CLASS}>
          <dt className="text-caption text-hero-muted">{t('netWorth.ars')}</dt>
          <dd className="break-words text-small font-semibold">
            <MoneyText text={formatMoney(ars, 'ARS', locale)} />
          </dd>
        </div>
        <div className={PART_CLASS}>
          <dt className="text-caption text-hero-muted">{t('netWorth.usd')}</dt>
          <dd className="break-words text-small font-semibold">
            <MoneyText text={formatMoney(usd, 'USD', locale)} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SeriesFailure({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const t = useTranslations('dashboard.chart');
  // A double tap lands before the parent reports `retrying`, so the press is locked here.
  const pressed = useRef(false);
  useEffect(() => {
    if (!retrying) pressed.current = false;
  }, [retrying]);

  return (
    <div role="alert" className="flex min-w-0 flex-col items-start gap-3">
      <p className="text-small">{t('failed')}</p>
      <Button
        variant="outline"
        disabled={retrying}
        onClick={() => {
          if (pressed.current) return;
          pressed.current = true;
          onRetry();
        }}
      >
        {t('retry')}
      </Button>
    </div>
  );
}
