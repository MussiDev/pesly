'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import type { AttentionItem } from '../attention/attention-items';
import type { ActionView } from '../dashboard-view';

const LINK_CLASS =
  'flex min-h-11 flex-col justify-center gap-0.5 rounded-md px-5 py-2 focus-visible:outline-2';

type ServerLabel = 'overdueOccurrence' | 'pendingOccurrence' | 'statementDue' | 'unknown';

function serverLabel(action: ActionView): ServerLabel {
  const kind = action.kind;
  if (kind.includes('statement') || kind.includes('card')) return 'statementDue';
  if (kind.includes('overdue')) return 'overdueOccurrence';
  if (kind.includes('pending') || kind.includes('occurrence') || kind.includes('payment')) {
    return 'pendingOccurrence';
  }
  return 'unknown';
}

function ServerItem({ action, locale }: { action: ActionView; locale: Locale }) {
  const t = useTranslations('dashboard.attention');
  const details = [
    action.name,
    action.date === null ? null : formatCalendarDate(action.date.slice(0, 10), locale),
    action.amount === null || action.currency === null
      ? null
      : formatMoney(action.amount, action.currency, locale),
  ].filter((part): part is string => part !== null);
  return (
    <>
      <span className="font-semibold">{t(serverLabel(action))}</span>
      {details.length > 0 ? (
        <span className="text-small text-muted-foreground">{details.join(' · ')}</span>
      ) : null}
      {action.overdue ? (
        <span className="text-small font-semibold text-destructive">{t('overdue')}</span>
      ) : null}
    </>
  );
}

/** The things to do first: server actions, then the failed changes waiting on this device. */
export function DoTheseFirst({ locale, items }: { locale: Locale; items: AttentionItem[] }) {
  const t = useTranslations('dashboard.attention');
  if (items.length === 0) return null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="grid">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className={LINK_CLASS}>
                {item.source === 'server' ? (
                  <ServerItem action={item.action} locale={locale} />
                ) : (
                  <span className="font-semibold">{t(item.kind, { count: item.count })}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
