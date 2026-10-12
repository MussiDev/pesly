import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface ReportNoticesProps {
  unconvertedShares: number;
  unconvertedInstallments: number;
  /** An account or tag filter is active. */
  filtered: boolean;
}

/** What the figures leave out: unconverted items, and installments and shares under a filter. */
export function ReportNotices({
  unconvertedShares,
  unconvertedInstallments,
  filtered,
}: ReportNoticesProps) {
  const t = useTranslations('reports.notices');
  const showCounts = unconvertedShares > 0 || unconvertedInstallments > 0;
  if (!showCounts && !filtered) return null;
  return (
    <div className="grid gap-2">
      {showCounts ? (
        <Alert role="status" variant="info">
          <Info aria-hidden />
          <AlertDescription>
            {t('unconverted', { shares: unconvertedShares, installments: unconvertedInstallments })}
          </AlertDescription>
        </Alert>
      ) : null}
      {filtered ? (
        <Alert role="status" variant="info">
          <Info aria-hidden />
          <AlertDescription>{t('filtered')}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
