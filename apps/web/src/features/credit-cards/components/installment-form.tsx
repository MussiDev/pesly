'use client';

import { INSTALLMENTS_MAX, type InstallmentSchedule } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormActions } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { readField } from '@/features/auth/read-field';
import {
  CategoryChips,
  type CategoryChipOption,
} from '@/features/movements/components/category-chips';
import { MovementField } from '@/features/movements/components/movement-field';
import { Link } from '@/i18n/navigation';
import {
  PURCHASE_PAYMENTS_MIN,
  type InstallmentFieldErrors,
  type InstallmentFormValues,
} from '../installment-request';
import { InstallmentSchedulePreview } from './installment-schedule-preview';

/** A full catalog path, plus the wait in seconds for the write limit message. */
export interface InstallmentAlertMessage {
  path: string;
  seconds?: number;
}

export interface InstallmentFormErrors {
  form?: InstallmentAlertMessage;
  fields?: InstallmentFieldErrors;
}

export type InstallmentCategoryOption = CategoryChipOption;

/** The fields the schedule preview depends on, as typed (unparsed). */
export type InstallmentDraftValues = Pick<
  InstallmentFormValues,
  'currency' | 'amount' | 'installments' | 'purchasedOn'
>;

export interface InstallmentFormProps {
  cardId: string;
  /** The open expense categories, already labelled for the language. */
  categories: readonly InstallmentCategoryOption[];
  /** `YYYY-MM-DD`, today in the user's time zone. */
  defaultPurchasedOn: string;
  pending: boolean;
  errors: InstallmentFormErrors;
  onSubmit: (values: InstallmentFormValues) => void;
  /** Called on every edit of the fields the preview depends on. */
  onDraftChange: (draft: InstallmentDraftValues) => void;
  /** The payments the typed purchase would get, or `null` while the input is not valid. */
  schedule: InstallmentSchedule | null;
  /** The typed currency, normalised by the container. */
  currency: 'ARS' | 'USD';
}

const CURRENCIES = ['ARS', 'USD'] as const;

/** Presentational: a card purchase in ARS or USD, paid in one payment or in installments. */
export function InstallmentForm({
  cardId,
  categories,
  defaultPurchasedOn,
  pending,
  errors,
  onSubmit,
  onDraftChange,
  schedule,
  currency,
}: InstallmentFormProps) {
  const t = useTranslations('creditCards.installments');
  const tAll = useTranslations();
  const categoryErrorId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  function reportDraft(form: HTMLFormElement) {
    onDraftChange({
      currency: readField(form, 'currency'),
      amount: readField(form, 'amount'),
      installments: readField(form, 'installments'),
      purchasedOn: readField(form, 'purchasedOn'),
    });
  }

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
      amount: readField(form, 'amount'),
      installments: readField(form, 'installments'),
      categoryId: readField(form, 'categoryId'),
      purchasedOn: readField(form, 'purchasedOn'),
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
        <form
          ref={formRef}
          className="grid gap-4"
          noValidate
          onSubmit={handleSubmit}
          onChange={(event) => {
            reportDraft(event.currentTarget);
          }}
        >
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
              <Select name="currency" defaultValue="ARS" required {...control}>
                {CURRENCIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
          <MovementField label={t('fields.amount')} error={errors.fields?.amount}>
            {(control) => <MoneyInput name="amount" required {...control} />}
          </MovementField>
          <MovementField label={t('fields.installments')} error={errors.fields?.installments}>
            {(control) => (
              <Input
                name="installments"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={t('fields.installmentsHint', {
                  min: PURCHASE_PAYMENTS_MIN,
                  max: INSTALLMENTS_MAX,
                })}
                required
                {...control}
              />
            )}
          </MovementField>
          <InstallmentSchedulePreview schedule={schedule} currency={currency} />
          <div className="grid min-w-0 gap-2">
            {/* The same icon grid as a personal expense: one way to pick a category everywhere. */}
            <CategoryChips
              label={t('fields.category')}
              categories={categories}
              defaultValue=""
              invalid={Boolean(errors.fields?.category)}
              describedBy={errors.fields?.category ? `${categoryErrorId}-message` : undefined}
            />
            {errors.fields?.category ? (
              <p id={`${categoryErrorId}-message`} className="text-small text-destructive">
                {tAll(errors.fields.category)}
              </p>
            ) : null}
          </div>
          <MovementField label={t('fields.purchasedOn')} error={errors.fields?.purchasedOn}>
            {(control) => (
              <Input
                name="purchasedOn"
                type="date"
                defaultValue={defaultPurchasedOn}
                required
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('fields.note')} error={errors.fields?.note}>
            {(control) => <Input name="note" type="text" autoComplete="off" {...control} />}
          </MovementField>
          <FormActions>
            <Button type="submit" disabled={pending}>
              {pending ? t('pending') : t('submit')}
            </Button>
            <Link href={`/cards/${cardId}`} className={buttonVariants({ variant: 'ghost' })}>
              {t('back')}
            </Link>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}
