import { useLocale, useTranslations } from 'next-intl';
import type { AccountCurrency } from '@pesly/shared';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format-amount';
import type { PaymentRow } from '../settlements/balance-view';

interface SuggestedPaymentsProps {
  currency: AccountCurrency;
  payments: PaymentRow[];
  onRecord: (payment: PaymentRow) => void;
}

/** The payments that would settle the currency, each with a button that opens the form on it. */
export function SuggestedPayments({ currency, payments, onRecord }: SuggestedPaymentsProps) {
  const t = useTranslations('groups.balances');
  const tDetail = useTranslations('groups.detail');
  const language = useLocale() === 'en' ? 'en' : 'es';

  if (payments.length === 0) return null;

  return (
    <div className="grid gap-2">
      <h3 className="text-base font-semibold">{t('suggestedTitle')}</h3>
      <ul className="grid gap-2">
        {payments.map((payment) => (
          <li
            key={`${payment.fromMemberId}-${payment.toMemberId}`}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              {t('payment', {
                payer: payment.fromName ?? tDetail('unnamed'),
                payee: payment.toName ?? tDetail('unnamed'),
                amount: formatMoney(payment.amount, currency, language),
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
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
