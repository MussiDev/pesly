import { useTranslations } from 'next-intl';

/** Says how many shares or installments are missing from the month's figures; nothing at 0. */
export function MonthNotice({ count }: { count: number }) {
  const t = useTranslations('dashboard.month');
  if (count <= 0) return null;
  return (
    <div
      role="note"
      className="min-w-0 rounded-card border border-border bg-card px-4 py-3 text-small text-foreground"
    >
      <p className="font-medium">{t('leftOut', { count })}</p>
      <p className="text-muted-foreground">{t('leftOutReason')}</p>
    </div>
  );
}
