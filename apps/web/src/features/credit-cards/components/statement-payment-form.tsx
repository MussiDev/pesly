'use client';

import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';
import { impliedRatePreview } from '@/features/movements/implied-rate-preview';
import { Link } from '@/i18n/navigation';
import type {
  StatementPaymentFieldErrors,
  StatementPaymentFormValues,
} from '../statement-payment-request';

/** A full catalog path, plus the wait in seconds for the write limit message. */
export interface StatementPaymentAlertMessage {
  path: string;
  seconds?: number;
}

export interface StatementPaymentFormErrors {
  form?: StatementPaymentAlertMessage;
  fields?: StatementPaymentFieldErrors;
}

export interface StatementPaymentAccountOption {
  id: string;
  label: string;
  currency: 'ARS' | 'USD';
}

export interface StatementPaymentFormProps {
  cardId: string;
  /** The accounts the person can pay from, without the card's own. */
  accounts: readonly StatementPaymentAccountOption[];
  defaultOccurredAt: string;
  pending: boolean;
  errors: StatementPaymentFormErrors;
  onSubmit: (values: StatementPaymentFormValues) => void;
}

const CURRENCIES = ['ARS', 'USD'] as const;

/** Stand-in destination of the rate preview: the card's USD account. */
const CARD_USD_ID = 'card-usd';

/**
 * The payment screen (FR-01). An ARS payment is offered the ARS accounts; a USD one is offered
 * every account, and an ARS source adds the pesos debited with the rate derived from them.
 */
export function StatementPaymentForm({
  cardId,
  accounts,
  defaultOccurredAt,
  pending,
  errors,
  onSubmit,
}: StatementPaymentFormProps) {
  const t = useTranslations('creditCards.payments');
  const tExchange = useTranslations('movements.exchange');
  const locale = useLocale();
  const tAll = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);
  const [currency, setCurrency] = useState<string>('ARS');
  const [sourceId, setSourceId] = useState('');
  const [usdAmount, setUsdAmount] = useState('');
  const [pesosAmount, setPesosAmount] = useState('');
  const sourceCurrency = accounts.find((account) => account.id === sourceId)?.currency;
  const exchange = currency === 'USD' && sourceCurrency === 'ARS';
  const preview = impliedRatePreview(
    {
      accountId: sourceId,
      destinationAccountId: CARD_USD_ID,
      amount: pesosAmount,
      destinationAmount: usdAmount,
    },
    [
      { id: sourceId, currency: 'ARS' },
      { id: CARD_USD_ID, currency: 'USD' },
    ],
    locale,
  );

  // After a failed submit, focus the first invalid field so its message is announced with it.
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      currency: readField(form, 'currency'),
      sourceAccountId: readField(form, 'sourceAccountId'),
      amount: readField(form, 'amount'),
      pesosAmount: readField(form, 'pesosAmount'),
      occurredAt: readField(form, 'occurredAt'),
      note: readField(form, 'note'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          {errors.form ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                {tAll(errors.form.path, { seconds: errors.form.seconds ?? 0 })}
              </AlertDescription>
            </Alert>
          ) : null}
          <MovementField label={t('fields.currency')} error={errors.fields?.currency}>
            {(control) => (
              <Select
                name="currency"
                value={currency}
                required
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setSourceId('');
                  setPesosAmount('');
                }}
                {...control}
              >
                {CURRENCIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
          <MovementField label={t('fields.sourceAccount')} error={errors.fields?.sourceAccount}>
            {(control) => (
              // Keyed by currency so a pick of the other currency never survives the change.
              <Select
                key={currency}
                name="sourceAccountId"
                defaultValue=""
                required
                onChange={(event) => {
                  setSourceId(event.target.value);
                }}
                {...control}
              >
                <option value="">{t('fields.sourceAccountPlaceholder')}</option>
                {accounts
                  .filter((account) => currency === 'USD' || account.currency === currency)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
              </Select>
            )}
          </MovementField>
          <MovementField label={t('fields.amount')} error={errors.fields?.amount}>
            {(control) => (
              <MoneyInput
                name="amount"
                required
                onChange={(event) => {
                  setUsdAmount(event.target.value);
                }}
                {...control}
              />
            )}
          </MovementField>
          {exchange ? (
            <>
              <MovementField label={t('fields.pesosAmount')} error={errors.fields?.pesosAmount}>
                {(control) => (
                  <MoneyInput
                    name="pesosAmount"
                    required
                    onChange={(event) => {
                      setPesosAmount(event.target.value);
                    }}
                    {...control}
                  />
                )}
              </MovementField>
              <p role="status" className="text-sm text-muted-foreground">
                {preview.kind === 'rate'
                  ? tExchange('impliedRate', { rate: preview.text })
                  : preview.kind === 'empty'
                    ? tExchange('impliedRateEmpty')
                    : tExchange('impliedRateOutOfRange')}
              </p>
            </>
          ) : null}
          <MovementField label={t('fields.occurredAt')} error={errors.fields?.occurredAt}>
            {(control) => (
              <Input
                name="occurredAt"
                type="datetime-local"
                defaultValue={defaultOccurredAt}
                required
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('fields.note')} error={errors.fields?.note}>
            {(control) => <Input name="note" type="text" autoComplete="off" {...control} />}
          </MovementField>
          <Button type="submit" disabled={pending}>
            {pending ? t('pending') : t('submit')}
          </Button>
          <Link href={`/cards/${cardId}`} className={buttonVariants({ variant: 'ghost' })}>
            {t('back')}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
