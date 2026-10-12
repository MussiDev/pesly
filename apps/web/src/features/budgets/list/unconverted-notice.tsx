'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Group shares in the other currency that no frozen rate could convert; absent at 0 (FR-07). */
export function UnconvertedNotice({ count }: { count: number }) {
  const t = useTranslations('budgets.card');
  if (count <= 0) return null;
  return (
    <p className="flex items-start gap-2 text-small text-muted-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{t('unconvertedShares', { count })}</span>
    </p>
  );
}
