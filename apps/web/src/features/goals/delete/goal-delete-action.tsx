'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApiClient } from '@/lib/api-client-provider';
import { goalFailureKey } from '../helpers/goal-failure';
import { GoalDeleteConfirmation } from './goal-delete-confirmation';

export interface GoalDeleteActionProps {
  goalId: string;
  onDeleted: () => void;
}

/** A delete button that opens an inline confirmation; nothing is sent until it is confirmed. */
export function GoalDeleteAction({ goalId, onDeleted }: GoalDeleteActionProps) {
  const api = useApiClient();
  const t = useTranslations('goals.detail');
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
    try {
      const result = await api.deleteGoal(goalId);
      if (result.ok) {
        onDeleted();
        return;
      }
      const key = goalFailureKey(result);
      setFailure(key.kind === 'not-found' ? 'goals.detail.notFound.description' : key.key);
    } finally {
      locked.current = false;
      setPending(false);
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
    <GoalDeleteConfirmation
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
