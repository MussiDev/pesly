'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';

export interface SignOutConfirmationProps {
  /** How many changes have not reached the server and would be lost. */
  count: number;
  signingOut: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before a sign out that would lose changes not yet synced; cancel takes the focus. */
export function SignOutConfirmation({
  count,
  signingOut,
  onConfirm,
  onCancel,
}: SignOutConfirmationProps) {
  const t = useTranslations('auth.signOut');
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      className="grid gap-3 rounded-card bg-card p-5 text-card-foreground shadow-xs"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !signingOut) onCancel();
      }}
    >
      <p id={titleId} className="text-body font-medium">
        {t('confirmTitle')}
      </p>
      <p id={bodyId} className="text-small text-muted-foreground">
        {t('confirmBody', { count })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={signingOut} onClick={onConfirm}>
          {t('confirm')}
        </Button>
        <Button
          ref={cancelRef}
          size="sm"
          variant="outline"
          disabled={signingOut}
          onClick={onCancel}
        >
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
