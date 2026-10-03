'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Confirms a save until the form is submitted again. */
export function SavedNotice({ saved }: { saved: boolean }) {
  const t = useTranslations('profile');
  if (!saved) return null;
  return (
    <Alert variant="success" role="status">
      <CircleCheck aria-hidden />
      <AlertDescription>{t('saved')}</AlertDescription>
    </Alert>
  );
}
