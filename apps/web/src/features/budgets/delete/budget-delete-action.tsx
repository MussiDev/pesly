'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApiClient } from '@/lib/api-client-provider';
import { budgetFailureKey } from '../helpers/budget-failure';
import { BudgetDeleteConfirmation } from './budget-delete-confirmation';

export interface BudgetDeleteActionProps {
  budgetId: string;
  onDeleted: () => void;
}

/** A delete button that opens an inline confirmation; nothing is sent until it is confirmed. */
export function BudgetDeleteAction({ budgetId, onDeleted }: BudgetDeleteActionProps) {
  const api = useApiClient();
  const t = useTranslations('budgets.detail');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  // A ref, not state: a second tap in the same tick must see the first one.
  const locked = useRef(false);

  async function confirm() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setFailure(undefined);
    let succeeded = false;
    try {
      const result = await api.deleteBudget(budgetId);
      if (result.ok) {
        succeeded = true;
        onDeleted();
        return;
      }
      const key = budgetFailureKey(result);
      setFailure(key.kind === 'not-found' ? 'budgets.detail.notFound.description' : key.key);
    } finally {
      // After a success the budget is gone: stay locked so a later tap cannot send a second DELETE.
      if (!succeeded) {
        locked.current = false;
        setPending(false);
      }
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('delete')}
      </Button>
    );
  }

  return (
    <BudgetDeleteConfirmation
      pending={pending}
      failure={failure}
      onConfirm={() => {
        void confirm();
      }}
      onCancel={() => {
        setOpen(false);
        setFailure(undefined);
      }}
    />
  );
}
