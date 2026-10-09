'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';
import type { ConfirmFormValues, RecurringFieldMessage } from '../recurring-request';

export interface ConfirmFormErrors {
  /** A full catalog path. */
  form?: string;
  fields?: { amount?: RecurringFieldMessage; date?: RecurringFieldMessage };
}

interface ConfirmOccurrenceFormProps {
  name: string;
  /** The payment amount, formatted for the language. */
  defaultAmount: string;
  defaultDate: string;
  pending: boolean;
  errors: ConfirmFormErrors;
  onSubmit: (values: ConfirmFormValues) => void;
  onCancel: () => void;
}

/** Records one occurrence as an expense; amount and date start from the payment's and are editable. */
export function ConfirmOccurrenceForm({
  name,
  defaultAmount,
  defaultDate,
  pending,
  errors,
  onSubmit,
  onCancel,
}: ConfirmOccurrenceFormProps) {
  const t = useTranslations('recurring');
  const tAll = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({ amount: readField(form, 'amount'), date: readField(form, 'date') });
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      aria-label={t('confirm.title')}
      className="grid gap-4 rounded-xl border bg-card p-4"
    >
      <p className="text-small text-muted-foreground">{t('confirm.description', { name })}</p>
      {errors.form ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tAll(errors.form)}</AlertDescription>
        </Alert>
      ) : null}
      <MovementField label={t('confirm.amount')} error={errors.fields?.amount}>
        {(control) => (
          <MoneyInput name="amount" defaultValue={defaultAmount} required {...control} />
        )}
      </MovementField>
      <MovementField label={t('confirm.date')} error={errors.fields?.date}>
        {(control) => <Input name="date" type="date" defaultValue={defaultDate} {...control} />}
      </MovementField>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t('actions.saving') : t('confirm.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {t('actions.cancel')}
        </Button>
      </div>
    </form>
  );
}
