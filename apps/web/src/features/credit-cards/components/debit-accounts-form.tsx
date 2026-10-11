'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { MovementField } from '@/features/movements/components/movement-field';
import type { DebitAccountsValues } from '../debit-accounts-request';

export interface DebitAccountOption {
  id: string;
  label: string;
}

interface DebitAccountsFormProps {
  /** The saved links; `null` means none. */
  saved: { debitArsAccountId: string | null; debitUsdAccountId: string | null };
  /** Only the accounts that can be picked, already filtered by currency. */
  arsOptions: readonly DebitAccountOption[];
  usdOptions: readonly DebitAccountOption[];
  pending: boolean;
  /** A full catalog path shown as an alert; the selection stays as the user left it. */
  error: string | undefined;
  onSave: (values: DebitAccountsValues) => void;
}

/** The automatic debit section of the card page: one account per currency, or none (FR-01). */
export function DebitAccountsForm({
  saved,
  arsOptions,
  usdOptions,
  pending,
  error,
  onSave,
}: DebitAccountsFormProps) {
  const t = useTranslations('creditCards.detail');
  const tAll = useTranslations();
  const [values, setValues] = useState<DebitAccountsValues>({
    ars: saved.debitArsAccountId ?? '',
    usd: saved.debitUsdAccountId ?? '',
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(values);
  }

  const picker = (
    name: keyof DebitAccountsValues,
    label: string,
    options: readonly DebitAccountOption[],
  ) => (
    <MovementField label={label} error={undefined}>
      {(control) => (
        <Select
          name={name}
          value={values[name]}
          onChange={(event) => {
            setValues((current) => ({ ...current, [name]: event.target.value }));
          }}
          {...control}
        >
          <option value="">{t('debitNone')}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </MovementField>
  );

  return (
    <form noValidate onSubmit={submit} className="grid gap-4 rounded-card bg-card p-4">
      <h2 className="text-heading">{t('debitTitle')}</h2>
      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{tAll(error)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {picker('ars', t('debitArs'), arsOptions)}
        {picker('usd', t('debitUsd'), usdOptions)}
      </div>
      <p className="text-small text-muted-foreground">{t('debitNote')}</p>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {t('debitSave')}
        </Button>
      </div>
    </form>
  );
}
