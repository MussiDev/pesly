'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';

/**
 * Shown above a fresh entry form after a save: the rate frozen on the movement (already formatted)
 * and the way to the list. The form stays right below, ready for the next movement.
 */
export function MovementSaved({ rate }: { rate: string }) {
  const t = useTranslations('movements.saved');

  return (
    <Alert variant="success" role="status">
      <CircleCheck aria-hidden />
      <AlertDescription>
        <p className="font-medium text-foreground">{t('title')}</p>
        <p>{t('rate', { rate })}</p>
        <Link
          href="/movements"
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('back')}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
