'use client';

import { TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Tells the user the browser may delete the offline copy when the device runs low on space. Once
 * read it can be closed: it is advice, not something to act on every visit.
 */
export function StorageWarning({ onDismiss }: { onDismiss?: (() => void) | undefined }) {
  const t = useTranslations('app');
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-4 desk:px-8">
      <Alert className="py-2.5 pr-12">
        <TriangleAlert aria-hidden />
        <AlertDescription className="text-caption">{t('storageWarning')}</AlertDescription>
        {onDismiss === undefined ? null : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('storageWarningDismiss')}
            className="absolute top-0 right-0"
            onClick={onDismiss}
          >
            <X aria-hidden />
          </Button>
        )}
      </Alert>
    </div>
  );
}
