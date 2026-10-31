'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { FormActions } from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MovementField } from '@/features/movements/components/movement-field';
import type {
  SettlementEditFieldErrors,
  SettlementEditValues,
} from '../edit/settlement-edit-request';

interface SettlementEditFormProps {
  values: SettlementEditValues;
  errors: SettlementEditFieldErrors;
  /** The names of the two parties, shown as text: they cannot be changed here. */
  payer: string;
  payee: string;
  currency: string;
  hasAccount: boolean;
  pending: boolean;
  /** The device queue cannot be written, so a save would be lost. */
  unavailable: boolean;
  onChange: (name: keyof SettlementEditValues, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

/** Amount and date are the only inputs of a settlement edit; everything else is read-only text. */
export function SettlementEditForm({
  values,
  errors,
  payer,
  payee,
  currency,
  hasAccount,
  pending,
  unavailable,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
}: SettlementEditFormProps) {
  const t = useTranslations('groups.edit.settlement');
  const tCommon = useTranslations('groups.edit.common');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-4">
          {unavailable ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{tCommon('unavailable')}</AlertDescription>
            </Alert>
          ) : null}
          <dl className="grid gap-3 text-small">
            <div className="grid gap-1">
              <dt className="text-muted-foreground">{t('fields.from')}</dt>
              <dd className="font-medium">{payer}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-muted-foreground">{t('fields.to')}</dt>
              <dd className="font-medium">{payee}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-muted-foreground">{t('fields.currency')}</dt>
              <dd className="font-medium">{currency}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-muted-foreground">{t('fields.account')}</dt>
              <dd className="font-medium">
                {hasAccount ? t('account.recorded') : t('account.none')}
              </dd>
            </div>
          </dl>
          <MovementField label={t('fields.amount')} error={errors.amount}>
            {(control) => (
              <Input
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                value={values.amount}
                onChange={(event) => {
                  onChange('amount', event.currentTarget.value);
                }}
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('fields.occurredAt')} error={errors.occurredAt}>
            {(control) => (
              <Input
                name="occurredAt"
                type="datetime-local"
                value={values.occurredAt}
                onChange={(event) => {
                  onChange('occurredAt', event.currentTarget.value);
                }}
                {...control}
              />
            )}
          </MovementField>
          <FormActions>
            <Button type="submit" disabled={pending}>
              {pending ? t('pending') : t('submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('cancel')}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onDelete}>
              {tCommon('actions.delete')}
            </Button>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}
