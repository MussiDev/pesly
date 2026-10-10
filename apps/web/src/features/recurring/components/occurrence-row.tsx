'use client';

import type { UpcomingItem, UpcomingKind } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { calendarDay, formatCalendarDate, shortMonth } from '@/features/credit-cards/format-dates';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatAmount, formatMoney } from '@/lib/format-amount';
import type { RecurringLookups } from './recurring-lookups';

const BADGE_VARIANT = {
  overdue: 'destructive',
  pending: 'warning',
  scheduled: 'default',
} as const satisfies Record<UpcomingKind, string>;

/** The amount with its account's currency; an account that is not known shows the bare number. */
export function useAmountText(amount: string, accountId: string, lookups: RecurringLookups) {
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const currency = lookups.accounts[accountId]?.currency;
  return currency === undefined
    ? formatAmount(BigInt(amount), locale)
    : formatMoney(BigInt(amount), currency, locale);
}

interface OccurrenceRowProps {
  item: UpcomingItem;
  lookups: RecurringLookups;
  pending: boolean;
  onConfirm: (item: UpcomingItem) => void;
  onSkip: (item: UpcomingItem) => void;
}

/** One upcoming item; only overdue and pending ones can be confirmed or skipped. */
export function OccurrenceRow({ item, lookups, pending, onConfirm, onSkip }: OccurrenceRowProps) {
  const t = useTranslations('recurring');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const amountText = useAmountText(item.amount, item.accountId, lookups);
  const actionable = item.kind !== 'scheduled' && item.occurrenceId !== null;
  const account = lookups.accounts[item.accountId]?.name ?? t('list.unknownAccount');
  const category = lookups.categories[item.categoryId] ?? t('list.unknownCategory');

  const dueText = t('list.dueOn', { date: formatCalendarDate(item.dueDate, locale) });

  return (
    <>
      <ListRow
        leading={
          <span aria-hidden="true" className="grid w-11 justify-items-center leading-tight">
            <span className="text-heading font-bold">{calendarDay(item.dueDate)}</span>
            <span className="text-nav text-muted-foreground">
              {shortMonth(item.dueDate, locale)}
            </span>
          </span>
        }
        title={
          <Link
            href={`/recurring/${item.paymentId}`}
            className="rounded-md focus-visible:outline-2"
          >
            {item.name}
          </Link>
        }
        description={
          <>
            <span className={item.kind === 'scheduled' ? undefined : 'font-semibold text-warning'}>
              {dueText}
            </span>
            <span className="block">
              {account} · {category}
            </span>
          </>
        }
        trailing={
          <span className="grid justify-items-end gap-1">
            <span className="font-bold tabular-nums">{amountText}</span>
            <Badge variant={BADGE_VARIANT[item.kind]}>{t(`status.${item.kind}`)}</Badge>
          </span>
        }
      />
      {actionable ? (
        <div className="flex flex-wrap justify-end gap-2 pb-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            aria-label={`${t('actions.skip')} ${item.name}`}
            onClick={() => {
              onSkip(item);
            }}
          >
            {t('actions.skip')}
          </Button>
          <Button
            size="sm"
            disabled={pending}
            aria-label={`${t('actions.confirm')} ${item.name}`}
            onClick={() => {
              onConfirm(item);
            }}
          >
            {t('actions.confirm')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
