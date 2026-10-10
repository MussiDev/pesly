'use client';

import type { RecurringPaymentResponse } from '@pesly/shared';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { ListRow } from '@/components/ui/list-row';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatAmount, formatMoney } from '@/lib/format-amount';
import type { RecurringLookups } from './recurring-lookups';

interface RecurringPaymentListProps {
  payments: readonly RecurringPaymentResponse[];
  lookups: RecurringLookups;
}

/** Every recurring payment with its status and next date; each row opens the payment. */
export function RecurringPaymentList({ payments, lookups }: RecurringPaymentListProps) {
  const t = useTranslations('recurring');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';

  return (
    <ul
      className="divide-y divide-border/70 rounded-card bg-card px-4"
      aria-label={t('list.paymentsLabel')}
    >
      {payments.map((payment) => {
        const currency = lookups.accounts[payment.accountId]?.currency;
        const amount =
          currency === undefined
            ? formatAmount(BigInt(payment.amount), locale)
            : formatMoney(BigInt(payment.amount), currency, locale);
        return (
          <li key={payment.id} aria-label={payment.name}>
            <Link
              href={`/recurring/${payment.id}`}
              className="block rounded-md focus-visible:outline-2"
            >
              <ListRow
                interactive
                title={payment.name}
                description={
                  <>
                    <span className="tabular-nums">{amount}</span>
                    <span aria-hidden="true"> · </span>
                    <span>
                      {payment.nextDueDate === null
                        ? t('list.noNextDue')
                        : t('list.nextDue', {
                            date: formatCalendarDate(payment.nextDueDate, locale),
                          })}
                    </span>
                  </>
                }
                trailing={
                  <span className="flex items-center gap-2">
                    <Badge variant={payment.status === 'paused' ? 'default' : 'success'}>
                      {t(`status.${payment.status}`)}
                    </Badge>
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  </span>
                }
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
