'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';

interface MovementSavedProps {
  /** The rate stored on the movement (already formatted); absent for a transfer. */
  rate: string | undefined;
  /** `true` for the implied rate of an exchange, `false` for the frozen rate of an expense or income. */
  implied?: boolean;
}

/**
 * Shown above a fresh entry form after a save: its rate, when it has one, and the way to the list.
 * The form stays right below, ready for the next movement.
 */
export function MovementSaved({ rate, implied = false }: MovementSavedProps) {
  const t = useTranslations('movements.saved');

  return (
    <Alert variant="success" role="status">
      <CircleCheck aria-hidden />
      <AlertDescription>
        <p className="font-medium text-foreground">{t('title')}</p>
        {rate === undefined ? null : <p>{t(implied ? 'impliedRate' : 'rate', { rate })}</p>}
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
