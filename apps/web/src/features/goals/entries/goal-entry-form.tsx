'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';

export interface GoalEntryFormProps {
  kind: 'contribution' | 'withdrawal';
  pending: boolean;
  /** A full catalog path for the amount field. */
  fieldError?: string;
  /** A full catalog path for a failure of the request. */
  failure?: string;
  recorded: boolean;
  onSubmit: (amount: string) => void;
}

/** One amount and one submit; the amount stays as typed until the parent remounts the form. */
export function GoalEntryForm({
  kind,
  pending,
  fieldError,
  failure,
  recorded,
  onSubmit,
}: GoalEntryFormProps) {
  const t = useTranslations('goals.entries');
  const tAll = useTranslations();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'amount'));
  }

  return (
    <form className="grid gap-3" noValidate onSubmit={handleSubmit}>
      <h3 className="text-body font-medium">
        {kind === 'contribution' ? t('contributionTitle') : t('withdrawalTitle')}
      </h3>
      {failure ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tAll(failure)}</AlertDescription>
        </Alert>
      ) : null}
      <MovementField label={t('amount')} error={fieldError}>
        {(control) => <MoneyInput name="amount" required {...control} />}
      </MovementField>
      {recorded ? (
        <p role="status" className="text-small text-muted-foreground">
          {t('recorded')}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {kind === 'contribution' ? t('submitContribution') : t('submitWithdrawal')}
      </Button>
    </form>
  );
}
