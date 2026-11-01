import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatShortDate } from '@/features/credit-cards/format-dates';
import { formatMoney } from '@/lib/format-amount';
import { MoneyText } from '@/components/ui/money-text';
import type { Locale } from '@/i18n/routing';
import type { Currency, PendingCardView } from '../dashboard-view';

/**
 * The card money of this month's statements not paid yet, which the month's figures leave out
 * (FEAT-015 FR-02, FR-03, FR-08); nothing when nothing is pending.
 */
export function PendingCardNote({
  locale,
  currency,
  pending,
}: {
  locale: Locale;
  currency: Currency;
  pending: PendingCardView;
}) {
  const t = useTranslations('dashboard.month.pendingCard');
  if (pending.value <= 0n && pending.leftOutCount <= 0) return null;
  return (
    <div
      role="note"
      data-slot="pending-card-note"
      className="flex min-w-0 items-start gap-3 rounded-card border border-border bg-card px-4 py-3 text-small"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground [&>svg]:size-4"
      >
        <CreditCard />
      </span>
      <div className="grid min-w-0 gap-0.5">
        <p className="font-medium text-foreground">
          {t('label')}{' '}
          <span className="font-semibold tabular-nums">
            <MoneyText text={formatMoney(pending.value, currency, locale)} />
          </span>
        </p>
        {pending.nextDueDate !== null && (
          <p className="text-muted-foreground">
            {t('due', { date: formatShortDate(pending.nextDueDate, locale) })}
          </p>
        )}
        {pending.leftOutCount > 0 && (
          <p className="text-muted-foreground">{t('leftOut', { count: pending.leftOutCount })}</p>
        )}
        <p className="text-muted-foreground">{t('reason')}</p>
      </div>
    </div>
  );
}
