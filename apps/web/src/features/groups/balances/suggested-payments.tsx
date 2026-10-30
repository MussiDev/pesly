import { useLocale, useTranslations } from 'next-intl';
import type { AccountCurrency } from '@pesly/shared';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format-amount';
import type { PaymentRow } from '../settlements/balance-view';

interface SuggestedPaymentsProps {
  currency: AccountCurrency;
  payments: PaymentRow[];
  onRecord: (payment: PaymentRow) => void;
  /** False when the caller already titles the list, e.g. one list per currency under one heading. */
  showTitle?: boolean;
  /** An accessible name for a Record button; absent, the button keeps its visible text as its name. */
  recordLabel?: (payment: PaymentRow) => string;
}

/** The payments that would settle the currency, each with a button that opens the form on it. */
export function SuggestedPayments({
  currency,
  payments,
  onRecord,
  showTitle = true,
  recordLabel,
}: SuggestedPaymentsProps) {
  const t = useTranslations('groups.balances');
  const tDetail = useTranslations('groups.detail');
  const language = useLocale() === 'en' ? 'en' : 'es';

  if (payments.length === 0) return null;

  return (
    <div className="grid gap-2">
      {showTitle ? <h3 className="text-base font-semibold">{t('suggestedTitle')}</h3> : null}
      <ul className="grid gap-2">
        {payments.map((payment) => (
          <li
            key={`${payment.fromMemberId}-${payment.toMemberId}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="min-w-0 text-small">
              {t('payment', {
                payer: payment.fromName ?? tDetail('unnamed'),
                payee: payment.toName ?? tDetail('unnamed'),
                amount: formatMoney(payment.amount, currency, language),
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              aria-label={recordLabel?.(payment)}
              onClick={() => {
                onRecord(payment);
              }}
            >
              {t('record')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
