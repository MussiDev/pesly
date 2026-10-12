'use client';

import { formatMoney } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { Locale } from '@/i18n/routing';
import type { BudgetView } from '../helpers/budget-view';

/** Only rescales 0-100 to the 0-1 fraction the locale percent formatter expects (display, not money). */
const asFraction = (percent: number) => percent / 100;

/** The bar with its threshold markers, the over-budget state and the figures, as the API returned them. */
export function BudgetProgress({ view }: { view: BudgetView }) {
  const t = useTranslations('budgets.card');
  const locale = useLocale() as Locale;
  const money = (amount: bigint) => formatMoney(amount, view.currency, locale);
  const percentLabel = t('percentage', { percent: asFraction(view.percentage) });

  return (
    <div className="grid gap-2">
      <div className="relative py-1">
        <div
          role="progressbar"
          aria-label={percentLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.barWidth}
          className="h-2 w-full overflow-hidden rounded-pill bg-muted"
        >
          <div
            data-testid="budget-bar-fill"
            className={`h-full rounded-pill ${view.overBudget ? 'bg-destructive' : 'bg-primary'}`}
            style={{ width: `${view.barWidth}%` }}
          />
        </div>
        {view.markers.map((marker) => (
          <span
            key={marker.value}
            data-testid="budget-marker"
            aria-hidden="true"
            className="absolute top-0 h-4 w-0.5 -translate-x-full bg-foreground"
            style={{ left: `${marker.position}%` }}
          />
        ))}
      </div>
      <p className="text-small tabular-nums">
        {t('spentOfAvailable', { spent: money(view.spent), available: money(view.available) })}
      </p>
      {view.overBudget ? (
        <Badge variant="destructive" className="w-fit">
          {t('overBudget', { amount: money(view.remaining) })}
        </Badge>
      ) : (
        <p className="text-small tabular-nums">
          {t('remaining', { amount: money(view.remaining) })}
        </p>
      )}
      <p className="text-small text-muted-foreground">{percentLabel}</p>
      {view.rolloverEnabled ? (
        <p className="text-small text-muted-foreground tabular-nums">
          {t('rollover', { amount: money(view.rolloverAmount) })}
        </p>
      ) : null}
      {view.markers.length > 0 ? (
        <ul
          aria-label={t('thresholds')}
          className="flex flex-wrap gap-x-3 text-small text-muted-foreground"
        >
          {view.markers.map((marker) => (
            <li key={marker.value}>{t('marker', { percent: asFraction(marker.value) })}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
