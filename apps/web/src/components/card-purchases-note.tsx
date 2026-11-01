import { useTranslations } from 'next-intl';

/**
 * Says in which month a card purchase counts, on the screens that sum spending by month. The
 * dashboard's month counts it only once its statement is paid (FEAT-015); reports and budgets count
 * it in the due month either way.
 */
export function CardPurchasesNote({ rule = 'due' }: { rule?: 'due' | 'paid' }) {
  const t = useTranslations('cardPurchasesNote');
  return (
    <p data-slot="card-purchases-note" className="min-w-0 text-small text-muted-foreground">
      {rule === 'paid' ? t('paidText') : t('text')}
    </p>
  );
}
