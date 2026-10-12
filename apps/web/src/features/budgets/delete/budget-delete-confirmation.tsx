'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export interface BudgetDeleteConfirmationProps {
  pending: boolean;
  /** A full catalog path for a failed delete. */
  failure?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BudgetDeleteConfirmation({
  pending,
  failure,
  onConfirm,
  onCancel,
}: BudgetDeleteConfirmationProps) {
  const t = useTranslations('budgets.delete');
  const tAll = useTranslations();
  const base = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Opening the confirmation moves focus into it; cancel is the safe default for a destructive step.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-labelledby={`${base}-title`}
      aria-describedby={`${base}-description`}
      className="grid gap-3"
    >
      <h3 id={`${base}-title`} className="text-body font-medium">
        {t('title')}
      </h3>
      <p id={`${base}-description`} className="text-small text-muted-foreground">
        {t('description')}
      </p>
      {failure ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tAll(failure)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
          {t('confirm')}
        </Button>
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
