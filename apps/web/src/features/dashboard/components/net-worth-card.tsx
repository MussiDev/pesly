'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { drawnPoints } from '../chart/chart-geometry';
import { NetWorthChart } from '../chart/net-worth-chart';
import { NetWorthPointsList } from '../chart/net-worth-points-list';
import type { Currency, NetWorthView, SeriesPointView } from '../dashboard-view';
import { NetWorthNotice } from './net-worth-notice';

export type SeriesState =
  | { kind: 'ready'; points: SeriesPointView[] }
  | { kind: 'failed'; retrying: boolean; onRetry: () => void };

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
  const drawnCount = series.kind === 'ready' ? drawnPoints(series.points).length : 0;

  return (
    <Card className="min-w-0" aria-labelledby="net-worth-title" role="region">
      <CardHeader>
        <CardTitle as="h2" id="net-worth-title" className="text-muted-foreground">
          {t('netWorth.label')}
        </CardTitle>
        {netWorth.total === null ? null : (
          <p className="min-w-0 break-words text-display">
            {formatMoney(netWorth.total, currency, locale)}
          </p>
        )}
        {netWorth.total === null ? (
          <p className="text-small text-muted-foreground">{t('netWorth.conversionUnavailable')}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="grid gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
            <dt className="text-small text-muted-foreground">{t('netWorth.ars')}</dt>
            <dd className="break-words text-body">{formatMoney(netWorth.ars, 'ARS', locale)}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
            <dt className="text-small text-muted-foreground">{t('netWorth.usd')}</dt>
            <dd className="break-words text-body">{formatMoney(netWorth.usd, 'USD', locale)}</dd>
          </div>
        </dl>
        <NetWorthNotice count={netWorth.holdingsWithoutPrice} />
        {series.kind === 'ready' ? (
          <>
            <NetWorthChart locale={locale} currency={currency} points={series.points} />
            {drawnCount > 0 ? (
              <p className="text-caption text-muted-foreground">{t('netWorth.lastPointNote')}</p>
            ) : null}
            <NetWorthPointsList locale={locale} currency={currency} points={series.points} />
          </>
        ) : (
          <SeriesFailure retrying={series.retrying} onRetry={series.onRetry} />
        )}
      </CardContent>
    </Card>
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
