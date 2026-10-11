import { useTranslations } from 'next-intl';
import type { CurrencyBalanceView, PaymentRow } from '../settlements/balance-view';
import { MemberBalanceItem } from './member-balance-row';
import { SuggestedPayments } from './suggested-payments';

interface BalancesByCurrencyProps {
  view: CurrencyBalanceView;
  onRecord: (payment: PaymentRow) => void;
}

/** One currency: every member's balance, then what would settle it or the settled state. */
export function BalancesByCurrency({ view, onRecord }: BalancesByCurrencyProps) {
  const t = useTranslations('groups.balances');
  const label = t('sectionLabel', { currency: view.currency });

  return (
    <section aria-label={label} className="grid gap-3 rounded-card border bg-card p-4">
      <h2 className="text-heading">{label}</h2>
      <ul className="divide-y">
        {view.rows.map((row) => (
          <MemberBalanceItem key={row.memberId} row={row} currency={view.currency} />
        ))}
      </ul>
      {view.settled ? (
        <p className="text-small text-muted-foreground">{t('settled')}</p>
      ) : (
        <SuggestedPayments currency={view.currency} payments={view.payments} onRecord={onRecord} />
      )}
    </section>
  );
}
