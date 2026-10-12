import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/format-amount';
import type { Locale } from '@/i18n/routing';
import type { ChangedAmount, Currency, MonthView } from '../dashboard-view';
import { DeltaChip, type DeltaKind } from './delta-chip';

function KpiCard({
  label,
  kind,
  figure,
  currency,
  locale,
}: {
  label: string;
  kind: DeltaKind;
  figure: ChangedAmount;
  currency: Currency;
  locale: Locale;
}) {
  const labelId = useId();
  return (
    <Card role="group" aria-labelledby={labelId} className="min-w-0 gap-2 py-4">
      <CardContent className="grid min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span id={labelId} className="text-small text-muted-foreground">
            {label}
          </span>
          <span className="min-w-0 break-words text-heading font-semibold tabular-nums">
            {formatMoney(figure.value, currency, locale)}
          </span>
        </div>
        <div className="flex min-w-0">
          <DeltaChip change={figure.change} kind={kind} locale={locale} />
        </div>
      </CardContent>
    </Card>
  );
}

/** The month's expenses, income and net result, each with its change against the previous month. */
export function KpiCards({
  locale,
  currency,
  month,
}: {
  locale: Locale;
  currency: Currency;
  month: MonthView;
}) {
  const t = useTranslations('dashboard.month');
  return (
    <div className="grid min-w-0 gap-2">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <KpiCard
          label={t('expenses')}
          kind="expense"
          figure={month.expenses}
          currency={currency}
          locale={locale}
        />
        <KpiCard
          label={t('income')}
          kind="income"
          figure={month.income}
          currency={currency}
          locale={locale}
        />
        <KpiCard
          label={t('net')}
          kind="net"
          figure={month.net}
          currency={currency}
          locale={locale}
        />
      </div>
      <p className="text-caption text-muted-foreground">{t('comparison')}</p>
    </div>
  );
}
