'use client';

import type { UpcomingItem, UpcomingKind } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
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

  return (
    <ListRow
      title={
        <Link href={`/recurring/${item.paymentId}`} className="rounded-md focus-visible:outline-2">
          {item.name}
        </Link>
      }
      description={
        <>
          <span>{t('list.dueOn', { date: formatCalendarDate(item.dueDate, locale) })}</span>
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">{amountText}</span>
          <span className="block">
            {account} · {category}
          </span>
        </>
      }
      trailing={
        <span className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={BADGE_VARIANT[item.kind]}>{t(`status.${item.kind}`)}</Badge>
          {actionable ? (
            <>
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
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                aria-label={`${t('actions.skip')} ${item.name}`}
                onClick={() => {
                  onSkip(item);
                }}
              >
                {t('actions.skip')}
              </Button>
            </>
          ) : null}
        </span>
      }
    />
  );
}
