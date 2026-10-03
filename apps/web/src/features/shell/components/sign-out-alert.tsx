'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ApiErrorKey } from '@/lib/api-client';

/** Why signing out failed, in the user's language; nothing while there is no error. */
export function SignOutAlert({ error }: { error: ApiErrorKey | undefined }) {
  const t = useTranslations('errors');
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{t(error)}</AlertDescription>
    </Alert>
  );
}
