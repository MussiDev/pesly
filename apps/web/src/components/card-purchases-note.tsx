import { useTranslations } from 'next-intl';

/** Says in which month a card purchase counts, on the screens that sum spending by month. */
export function CardPurchasesNote() {
  const t = useTranslations('cardPurchasesNote');
  return (
    <p data-slot="card-purchases-note" className="min-w-0 text-small text-muted-foreground">
      {t('text')}
    </p>
  );
}
