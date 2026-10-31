import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface ReportPeriodProps {
  from: string;
  to: string;
  currency: 'ARS' | 'USD';
}

/** One eyebrow line above the figures, as NorteAR's: the resolved range and the display currency. */
export function ReportPeriod({ from, to, currency }: ReportPeriodProps) {
  const t = useTranslations('reports.meta');
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return (
    <p className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
      {t('period', { from: day(from), to: day(to) })} · {t('currency', { currency })}
    </p>
  );
}

/**
 * The small print at the bottom of a report: how card purchases are placed (on the reports that sum
 * by month) and where to change the display currency.
 */
export function ReportFootnote({ cardPurchases = false }: { cardPurchases?: boolean }) {
  const t = useTranslations('reports.meta');
  const tCard = useTranslations('cardPurchasesNote');
  return (
    <p className="text-caption text-muted-foreground">
      {cardPurchases ? <span data-slot="card-purchases-note">{tCard('text')} </span> : null}
      {t('currencyNote')}{' '}
      <Link
        href="/settings/profile"
        className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
      >
        {t('changeCurrency')}
      </Link>
    </p>
  );
}
