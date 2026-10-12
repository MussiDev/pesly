'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
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

  return (
    <div role="group" aria-labelledby="budget-delete-title" className="grid gap-3">
      <h3 id="budget-delete-title" className="text-body font-medium">
        {t('title')}
      </h3>
      <p className="text-small text-muted-foreground">{t('description')}</p>
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
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
