import { useTranslations } from 'next-intl';

/** Holdings with no price are left out of the net worth; nothing shows at 0. */
export function NetWorthNotice({ count }: { count: number }) {
  const t = useTranslations('dashboard.netWorth');
  if (count <= 0) return null;
  return (
    <p role="note" className="text-small text-muted-foreground">
      {t('holdingsWithoutPrice', { count })}
    </p>
  );
}
