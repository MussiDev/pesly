'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';
import type { SharesFieldErrors, SharesRangeValues } from './shares-request';

interface SharesRangeFormProps {
  defaults: SharesRangeValues;
  fields?: SharesFieldErrors;
  pending: boolean;
  onSubmit: (values: SharesRangeValues) => void;
}

/** The from and to days of the personal shares view. */
export function SharesRangeForm({ defaults, fields, pending, onSubmit }: SharesRangeFormProps) {
  const t = useTranslations('groups.shares');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fields]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({ from: readField(form, 'from'), to: readField(form, 'to') });
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      aria-label={t('rangeLabel')}
      className="grid gap-4 rounded-card bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
    >
      <MovementField label={t('from')} error={fields?.from}>
        {(control) => <Input type="date" name="from" defaultValue={defaults.from} {...control} />}
      </MovementField>
      <MovementField label={t('to')} error={fields?.to}>
        {(control) => <Input type="date" name="to" defaultValue={defaults.to} {...control} />}
      </MovementField>
      <div className="sm:pt-7">
        <Button type="submit" disabled={pending}>
          {t('apply')}
        </Button>
      </div>
    </form>
  );
}
