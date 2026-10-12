import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface CurrencyNoteProps {
  currency: 'ARS' | 'USD';
}

/** Says which currency the figures are in and where to change it. */
export function CurrencyNote({ currency }: CurrencyNoteProps) {
  const t = useTranslations('reports.currency');
  return (
    <p className="text-small text-muted-foreground">
      {t('note', { currency })}{' '}
      <Link
        href="/settings/profile"
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        {t('changeLink')}
      </Link>
    </p>
  );
}
