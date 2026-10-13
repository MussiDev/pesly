import type { AccountCurrency } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { SuggestedPayments } from '../balances/suggested-payments';
import type { CurrencyBalanceView, PaymentRow } from '../settlements/balance-view';
import { GroupSectionState, type SectionStatus } from './group-section-state';

interface GroupSuggestedPaymentsSectionProps {
  status: SectionStatus;
  views: readonly CurrencyBalanceView[];
  onRetry: () => void;
  onRecord: (currency: AccountCurrency, payment: PaymentRow) => void;
}

/** The payments that would settle each currency, on the group detail; pure, the container loads them. */
export function GroupSuggestedPaymentsSection({
  status,
  views,
  onRetry,
  onRecord,
}: GroupSuggestedPaymentsSectionProps) {
  const t = useTranslations('groups.detail');
  const withPayments = views.filter((view) => view.payments.length > 0);

  return (
    <section aria-labelledby="group-suggested-payments" className="grid gap-3">
      <h2 id="group-suggested-payments" className="text-heading">
        {t('suggestedTitle')}
      </h2>
      <GroupSectionState status={status} onRetry={onRetry}>
        {withPayments.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('allSettled')}</p>
        ) : (
          <div className="grid gap-4 rounded-card bg-card p-4">
            {withPayments.map((view) => (
              <SuggestedPayments
                key={view.currency}
                currency={view.currency}
                payments={view.payments}
                showTitle={false}
                recordLabel={(payment) =>
                  t('recordFor', {
                    payer: payment.fromName ?? t('unnamed'),
                    payee: payment.toName ?? t('unnamed'),
                  })
                }
                onRecord={(payment) => {
                  onRecord(view.currency, payment);
                }}
              />
            ))}
          </div>
        )}
      </GroupSectionState>
    </section>
  );
}
