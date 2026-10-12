'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Shown instead of the entry forms: a linked goal follows its account balance. */
export function LinkedGoalNotice() {
  const t = useTranslations('goals.detail');
  return (
    <Alert variant="info">
      <Info aria-hidden />
      <AlertDescription>{t('linkedNotice')}</AlertDescription>
    </Alert>
  );
}
