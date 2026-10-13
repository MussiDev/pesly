'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface UnconvertedNoticeProps {
  shares: number;
  installments: number;
}

/**
 * Group shares and card installments in the other currency that no frozen rate could convert,
 * counted together; absent at 0 (FR-07).
 */
export function UnconvertedNotice({ shares, installments }: UnconvertedNoticeProps) {
  const t = useTranslations('budgets.card');
  const count = shares + installments;
  if (count <= 0) return null;
  return (
    <p className="flex items-start gap-2 text-small text-muted-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{t('unconvertedShares', { count })}</span>
    </p>
  );
}
