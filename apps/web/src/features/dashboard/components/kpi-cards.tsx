import { ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/format-amount';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import type { ChangedAmount, Currency, MonthView } from '../dashboard-view';
import { DeltaChip, type DeltaKind } from './delta-chip';
import { MoneyText } from '@/components/ui/money-text';

/** The tint of each figure: spending in red, income in green, the result in the brand colour. */
const TONE: Record<DeltaKind, { figure: string; icon: string }> = {
  expense: { figure: 'text-expense', icon: 'bg-expense/10 text-expense' },
  income: { figure: 'text-income', icon: 'bg-income/10 text-income' },
  net: { figure: 'text-foreground', icon: 'bg-accent text-accent-foreground' },
};

function KpiCard({
  label,
  kind,
  icon,
  figure,
  currency,
  locale,
  className,
}: {
  label: string;
  kind: DeltaKind;
  icon: ReactNode;
  figure: ChangedAmount;
  currency: Currency;
  locale: Locale;
  className?: string;
}) {
  const labelId = useId();
  return (
    <Card role="group" aria-labelledby={labelId} className={cn('min-w-0 gap-2 py-4', className)}>
      <CardContent className="grid min-w-0 gap-2 px-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span
            id={labelId}
            className="text-caption font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {label}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4',
              TONE[kind].icon,
            )}
          >
            {icon}
          </span>
        </div>
        <span
          className={cn(
            'min-w-0 text-heading font-bold break-words tabular-nums',
            TONE[kind].figure,
          )}
        >
          <MoneyText text={formatMoney(figure.value, currency, locale)} />
        </span>
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
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard
          label={t('expenses')}
          kind="expense"
          icon={<ArrowUpRight />}
          figure={month.expenses}
          currency={currency}
          locale={locale}
        />
        <KpiCard
          label={t('income')}
          kind="income"
          icon={<ArrowDownRight />}
          figure={month.income}
          currency={currency}
          locale={locale}
        />
        <KpiCard
          label={t('net')}
          kind="net"
          icon={<Scale />}
          figure={month.net}
          currency={currency}
          locale={locale}
          className="col-span-2 sm:col-span-1"
        />
      </div>
      <p className="text-caption text-muted-foreground">{t('comparison')}</p>
    </div>
  );
}
