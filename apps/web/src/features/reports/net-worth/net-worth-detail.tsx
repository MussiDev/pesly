import { useTranslations } from 'next-intl';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import type { NetWorthPointView, ReportCurrency } from '../report-view';

export interface NetWorthDetailProps {
  locale: Locale;
  currency: ReportCurrency;
  point: NetWorthPointView;
}

/** The selected point: the converted total next to the ARS and USD parts, each in its own currency. */
export function NetWorthDetail({ locale, currency, point }: NetWorthDetailProps) {
  const t = useTranslations('reports.netWorth');
  const heading = t('selectedPoint', { date: formatCalendarDate(point.date, locale) });
  const rows: { key: string; label: string; value: string }[] = [
    {
      key: 'total',
      label: t('total'),
      value: point.total === null ? t('noRate') : formatMoney(point.total, currency, locale),
    },
    { key: 'ars', label: t('ars'), value: formatMoney(point.ars, 'ARS', locale) },
    { key: 'usd', label: t('usd'), value: formatMoney(point.usd, 'USD', locale) },
  ];
  return (
    <section
      data-testid="net-worth-detail"
      aria-label={heading}
      className="grid gap-2 rounded-card bg-card p-4 text-card-foreground"
    >
      <h3 className="text-small font-semibold">{heading}</h3>
      <dl className="grid gap-1 text-small">
        {rows.map((row) => (
          <div key={row.key} className="flex min-h-11 items-center justify-between gap-3">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="m-0 text-right tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {point.incomplete ? (
        <p className="text-small text-muted-foreground">{t('investmentsIncomplete')}</p>
      ) : null}
    </section>
  );
}
