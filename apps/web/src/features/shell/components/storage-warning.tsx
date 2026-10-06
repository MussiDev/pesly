'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Tells the user the browser may delete the offline copy when the device runs low on space. */
export function StorageWarning() {
  const t = useTranslations('app');
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-4 lg:px-8">
      <Alert>
        <TriangleAlert aria-hidden />
        <AlertDescription>{t('storageWarning')}</AlertDescription>
      </Alert>
    </div>
  );
}
