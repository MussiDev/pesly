'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Tells the user the browser may delete the offline copy when the device runs low on space. */
export function StorageWarning() {
  const t = useTranslations('app');
  return (
    <Alert>
      <TriangleAlert aria-hidden />
      <AlertDescription>{t('storageWarning')}</AlertDescription>
    </Alert>
  );
}
