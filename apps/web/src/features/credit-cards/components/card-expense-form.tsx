'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormActions } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedField } from '@/components/ui/segmented-field';
import { readField } from '@/features/auth/read-field';
import {
  CategoryChips,
  type CategoryChipOption,
} from '@/features/movements/components/category-chips';
import { MovementField } from '@/features/movements/components/movement-field';
import { Link } from '@/i18n/navigation';
import type { CardExpenseFieldErrors, CardExpenseFormValues } from '../card-expense-request';

/** A full catalog path, plus the wait in seconds for the write limit message. */
export interface CardExpenseAlertMessage {
  path: string;
  seconds?: number;
}

export interface CardExpenseFormErrors {
  form?: CardExpenseAlertMessage;
  fields?: CardExpenseFieldErrors;
}

export type CardExpenseCategoryOption = CategoryChipOption;

export interface CardExpenseFormProps {
  cardId: string;
  /** The open expense categories, already labelled for the language. */
  categories: readonly CardExpenseCategoryOption[];
  defaultOccurredAt: string;
  pending: boolean;
  errors: CardExpenseFormErrors;
  onSubmit: (values: CardExpenseFormValues) => void;
}

const CURRENCIES = ['ARS', 'USD'] as const;

export function CardExpenseForm({
  cardId,
  categories,
  defaultOccurredAt,
  pending,
  errors,
  onSubmit,
}: CardExpenseFormProps) {
  const t = useTranslations('creditCards.expense');
  const tAll = useTranslations();
  const categoryErrorId = useId();
  const formRef = useRef<HTMLFormElement>(null);

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
      categoryId: readField(form, 'categoryId'),
      amount: readField(form, 'amount'),
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
          <SegmentedField
            label={t('fields.currency')}
            name="currency"
            options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))}
            error={errors.fields?.currency ? tAll(errors.fields.currency) : undefined}
          />
          <MovementField label={t('fields.amount')} error={errors.fields?.amount}>
            {(control) => <MoneyInput name="amount" required {...control} />}
          </MovementField>
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
