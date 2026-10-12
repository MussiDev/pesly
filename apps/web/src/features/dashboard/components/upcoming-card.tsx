'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import type { UpcomingView } from '../dashboard-view';

interface UpcomingCardProps {
  locale: Locale;
  upcoming: UpcomingView[];
}

/** The next 7 days in the order returned; each entry links where the adapter says. */
export function UpcomingCard({ locale, upcoming }: UpcomingCardProps) {
  const t = useTranslations('dashboard.upcoming');
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {upcoming.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul aria-label={t('title')} className="grid gap-1">
            {upcoming.map((entry, index) => {
              const name =
                entry.name === null || entry.name === ''
                  ? t(entry.kind.includes('statement') ? 'statement' : 'payment')
                  : entry.name;
              return (
                <li key={`${entry.href}-${index}`} className="min-w-0">
                  <Link
                    href={entry.href}
                    className="flex min-h-11 min-w-0 items-center justify-between gap-3 focus-visible:outline-2"
                  >
                    <span className="grid min-w-0">
                      <span className="min-w-0 break-words text-body">{name}</span>
                      {entry.date !== null && (
                        <span className="text-caption text-muted-foreground">
                          {formatCalendarDate(entry.date, locale)}
                        </span>
                      )}
                    </span>
                    {entry.amount !== null && entry.currency !== null && (
                      <span className="shrink-0 text-small">
                        {formatMoney(entry.amount, entry.currency, locale)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
