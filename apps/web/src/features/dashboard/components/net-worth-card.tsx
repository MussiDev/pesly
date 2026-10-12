'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { drawnPoints } from '../chart/chart-geometry';
import { NetWorthChart } from '../chart/net-worth-chart';
import { NetWorthPointsList } from '../chart/net-worth-points-list';
import type { Currency, NetWorthView, SeriesPointView } from '../dashboard-view';
import { NetWorthNotice } from './net-worth-notice';

export type SeriesState =
  | { kind: 'ready'; currency: Currency; points: SeriesPointView[] }
  | { kind: 'failed'; retrying: boolean; onRetry: () => void };

/** One translucent tile on the navy card: side by side when both fit, stacked on a phone. */
const PART_CLASS =
  'flex min-w-0 flex-1 basis-56 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-2xl border border-hero-foreground/20 bg-hero-foreground/10 px-4 py-3';

/** The net worth figure of record, its ARS and USD parts and the chart (or its retry). */
export function NetWorthCard({
  locale,
  currency,
  netWorth,
  series,
}: {
  locale: Locale;
  currency: Currency;
  netWorth: NetWorthView;
  series: SeriesState;
}) {
  const t = useTranslations('dashboard');
  // Amounts in another currency would be labeled with the wrong one, so that series is not shown.
  const showSeries = series.kind === 'ready' && series.currency === currency;
  // The white card below the figures holds the notice and the chart; with neither it is left out.
  const hasDetail = netWorth.holdingsWithoutPrice > 0 || series.kind === 'failed' || showSeries;
  const drawnCount = series.kind === 'ready' && showSeries ? drawnPoints(series.points).length : 0;

  return (
    <section aria-labelledby="net-worth-title" className="grid min-w-0 content-start gap-3">
      <div className="grid min-w-0 gap-4 rounded-card bg-hero px-5 pt-4.5 pb-5 text-hero-foreground">
        <div className="grid min-w-0 gap-1">
          <h2 id="net-worth-title" className="text-small font-normal text-hero-muted">
            {t('netWorth.label')}
          </h2>
          {netWorth.total === null ? (
            <p className="text-small text-hero-muted">{t('netWorth.conversionUnavailable')}</p>
          ) : (
            <p className="min-w-0 break-words text-display">
              {formatMoney(netWorth.total, currency, locale)}
            </p>
          )}
        </div>
        <dl className="flex min-w-0 flex-wrap gap-2">
          <div className={PART_CLASS}>
            <dt className="text-caption text-hero-muted">{t('netWorth.ars')}</dt>
            <dd className="break-words text-body font-semibold">
              {formatMoney(netWorth.ars, 'ARS', locale)}
            </dd>
          </div>
          <div className={PART_CLASS}>
            <dt className="text-caption text-hero-muted">{t('netWorth.usd')}</dt>
            <dd className="break-words text-body font-semibold">
              {formatMoney(netWorth.usd, 'USD', locale)}
            </dd>
          </div>
        </dl>
      </div>
      {hasDetail ? (
        <Card className="min-w-0">
          <CardContent className="flex min-w-0 flex-col gap-4">
            <NetWorthNotice count={netWorth.holdingsWithoutPrice} />
            {series.kind === 'ready' ? (
              showSeries ? (
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
          </CardContent>
        </Card>
      ) : null}
    </section>
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
