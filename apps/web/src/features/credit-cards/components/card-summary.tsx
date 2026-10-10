'use client';

import type { StatementResponse } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { browserTimeZone } from '@/features/home/time-zone';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { cn } from '@/lib/utils';
import { cycleProgress, formatPeriod, formatShortDate } from '../format-dates';

interface CardSummaryProps {
  cardName: string;
  /** Newest first, as the API returns them. */
  statements: readonly StatementResponse[];
  pendingDebt: { ARS: string; USD: string };
}

/** Today as `YYYY-MM-DD` in the browser's zone (the en-CA layout is sortable and locale-free). */
function todayInZone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: browserTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** The card's open statement as the one saturated surface, with its cycle and two figures below. */
export function CardSummary({ cardName, statements, pendingDebt }: CardSummaryProps) {
  const t = useTranslations('creditCards.detail');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const openIndex = statements.findIndex((statement) => statement.status === 'open');
  const open = statements[openIndex];
  if (open === undefined) return null;

  const previous = statements[openIndex + 1];
  const progress = cycleProgress(open.closingDate, previous?.closingDate, todayInZone());
  const usd =
    BigInt(open.totals.USD) === 0n ? null : formatMoney(BigInt(open.totals.USD), 'USD', locale);
  const status = previous?.payments?.ARS.status;

  return (
    <div className="grid gap-4">
      <section
        aria-label={cardName}
        className="grid gap-4 rounded-card bg-hero px-5 pt-4.5 pb-5 text-hero-foreground"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-small font-bold">{cardName}</p>
          <p className="text-caption text-hero-muted">
            {formatPeriod(open.period, locale)} · {t('open')}
          </p>
        </div>
        <div className="grid gap-0.5">
          <p className="text-small text-hero-muted">{t('accumulated')}</p>
          <p className="flex flex-wrap items-baseline gap-x-3.5 text-display font-bold tabular-nums">
            <span>{formatMoney(BigInt(open.totals.ARS), 'ARS', locale)}</span>
            {usd === null ? null : <span className="text-heading text-hero-muted">{usd}</span>}
          </p>
        </div>
        <div className="grid gap-1.5">
          <div
            role="img"
            aria-label={t('cycleDay', { day: progress.day, length: progress.length })}
            className="h-1.5 overflow-hidden rounded-pill bg-hero-foreground/25"
          >
            <div
              className="h-full rounded-pill bg-hero-foreground"
              style={{ width: `${String(Math.round(progress.ratio * 100))}%` }}
            />
          </div>
          <div className="flex justify-between text-caption text-hero-muted">
            <span>{t('closes', { date: formatShortDate(open.closingDate, locale) })}</span>
            <span>{t('due', { date: formatShortDate(open.dueDate, locale) })}</span>
          </div>
        </div>
      </section>
      <dl className={cn('grid gap-2', previous === undefined ? 'grid-cols-1' : 'grid-cols-2')}>
        <div className="grid gap-1 rounded-2xl bg-card p-4">
          <dt className="text-caption text-muted-foreground">{t('futureInstallments')}</dt>
          <dd className="text-heading font-bold tabular-nums">
            {formatMoney(BigInt(pendingDebt.ARS), 'ARS', locale)}
          </dd>
        </div>
        {previous === undefined ? null : (
          <div className="grid gap-1 rounded-2xl bg-card p-4">
            <dt className="text-caption text-muted-foreground">
              {new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
                .format(new Date(`${previous.period}-01T00:00:00Z`))
                .replace(/^./, (first) => first.toUpperCase())}
            </dt>
            <dd
              className={cn(
                'text-heading font-bold',
                status === 'paid' ? 'text-success' : undefined,
              )}
            >
              {status === undefined ? t('closed') : t(`paymentStatus.${status}`)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
