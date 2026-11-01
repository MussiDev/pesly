'use client';

import {
  RECURRING_FREQUENCIES,
  RECURRING_MODES,
  RECURRING_NAME_MAX_LENGTH,
  REMINDER_DAYS_DEFAULT,
} from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { FormActions } from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedField } from '@/components/ui/segmented-field';
import { Select } from '@/components/ui/select';
import { readField } from '@/features/auth/read-field';
import {
  CategoryChips,
  type CategoryChipOption,
} from '@/features/movements/components/category-chips';
import { MovementField } from '@/features/movements/components/movement-field';
import { Link } from '@/i18n/navigation';
import type { RecurringFieldErrors, RecurringPaymentFormValues } from '../recurring-request';

export interface RecurringFormOption {
  id: string;
  label: string;
}

export interface RecurringFormErrors {
  /** A full catalog path. */
  form?: string;
  fields?: RecurringFieldErrors;
}

interface RecurringPaymentFormProps {
  mode: 'create' | 'edit';
  /** The values the form starts from; a new payment starts monthly, on confirmation. */
  initial?: RecurringPaymentFormValues;
  accounts: readonly RecurringFormOption[];
  /** The open expense categories, already labelled for the language. */
  categories: readonly CategoryChipOption[];
  defaultStartDate: string;
  pending: boolean;
  errors: RecurringFormErrors;
  onSubmit: (values: RecurringPaymentFormValues) => void;
  /** Without it, cancelling links back to the list. */
  onCancel?: () => void;
}

const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

/** Name, amount, where it is charged, how often, and whether it is recorded on its own. */
export function RecurringPaymentForm({
  mode,
  initial,
  accounts,
  categories,
  defaultStartDate,
  pending,
  errors,
  onSubmit,
  onCancel,
}: RecurringPaymentFormProps) {
  const t = useTranslations('recurring');
  const tAll = useTranslations();
  const categoryErrorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'monthly');

  // After a failed submit, focus the first invalid field so its message is announced with it.
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      name: readField(form, 'name'),
      amount: readField(form, 'amount'),
      accountId: readField(form, 'accountId'),
      categoryId: readField(form, 'categoryId'),
      frequency: readField(form, 'frequency'),
      weekday: readField(form, 'weekday'),
      dayOfMonth: readField(form, 'dayOfMonth'),
      month: readField(form, 'month'),
      startDate: readField(form, 'startDate'),
      endDate: readField(form, 'endDate'),
      mode: readField(form, 'mode'),
      reminderDays: readField(form, 'reminderDays'),
    });
  }

  const fields = errors.fields;
  const editing = mode === 'edit';
  const cancel = onCancel ? (
    <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
      {t('actions.cancel')}
    </Button>
  ) : (
    <Link href="/recurring" className={buttonVariants({ variant: 'ghost' })}>
      {t('actions.cancel')}
    </Link>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{editing ? t('form.editTitle') : t('list.newPayment')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-4">
          {errors.form ? <TranslatedAlert path={errors.form} /> : null}
          <MovementField label={t('fields.name')} error={fields?.name}>
            {(control) => (
              <Input
                name="name"
                autoComplete="off"
                maxLength={RECURRING_NAME_MAX_LENGTH * 2}
                defaultValue={initial?.name ?? ''}
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('fields.amount')} error={fields?.amount}>
            {(control) => (
              <MoneyInput name="amount" defaultValue={initial?.amount ?? ''} {...control} />
            )}
          </MovementField>
          <MovementField label={t('fields.account')} error={fields?.accountId}>
            {(control) => (
              <Select name="accountId" defaultValue={initial?.accountId ?? ''} {...control}>
                <option value="">{t('form.placeholder')}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
          <div className="grid min-w-0 gap-2">
            {/* The same icon grid as a personal expense: one way to pick a category everywhere. */}
            <CategoryChips
              label={t('fields.category')}
              categories={categories}
              defaultValue={initial?.categoryId ?? ''}
              invalid={Boolean(fields?.categoryId)}
              describedBy={fields?.categoryId ? `${categoryErrorId}-message` : undefined}
            />
            {fields?.categoryId ? (
              <p id={`${categoryErrorId}-message`} className="text-small text-destructive">
                {tAll(fields.categoryId)}
              </p>
            ) : null}
          </div>
          <SegmentedField
            label={t('frequency.label')}
            name="frequency"
            options={RECURRING_FREQUENCIES.map((value) => ({
              value,
              label: t(`frequency.${value}`),
            }))}
            value={frequency}
            onChange={setFrequency}
            error={fields?.frequency ? tAll(fields.frequency) : undefined}
          />
          {frequency === 'weekly' ? (
            <MovementField label={t('weekday.label')} error={fields?.weekday}>
              {(control) => (
                <Select name="weekday" defaultValue={initial?.weekday ?? ''} {...control}>
                  <option value="">{t('form.placeholder')}</option>
                  {WEEKDAYS.map((day) => (
                    <option key={day} value={day}>
                      {t(`weekday.${day}`)}
                    </option>
                  ))}
                </Select>
              )}
            </MovementField>
          ) : null}
          {frequency === 'yearly' ? (
            <MovementField label={t('month.label')} error={fields?.month}>
              {(control) => (
                <Select name="month" defaultValue={initial?.month ?? ''} {...control}>
                  <option value="">{t('form.placeholder')}</option>
                  {MONTHS.map((month) => (
                    <option key={month} value={month}>
                      {t(`month.${month}`)}
                    </option>
                  ))}
                </Select>
              )}
            </MovementField>
          ) : null}
          {frequency === 'monthly' || frequency === 'yearly' ? (
            <MovementField label={t('fields.dayOfMonth')} error={fields?.dayOfMonth}>
              {(control) => (
                <Input
                  name="dayOfMonth"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  defaultValue={initial?.dayOfMonth ?? ''}
                  {...control}
                />
              )}
            </MovementField>
          ) : null}
          <MovementField label={t('fields.startDate')} error={fields?.startDate}>
            {(control) => (
              <Input
                name="startDate"
                type="date"
                defaultValue={initial?.startDate ?? defaultStartDate}
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('fields.endDate')} error={fields?.endDate}>
            {(control) => (
              <Input
                name="endDate"
                type="date"
                defaultValue={initial?.endDate ?? ''}
                {...control}
              />
            )}
          </MovementField>
          <SegmentedField
            label={t('mode.label')}
            name="mode"
            options={RECURRING_MODES.map((value) => ({ value, label: t(`mode.${value}`) }))}
            defaultValue={initial?.mode ?? 'confirmation'}
            hint={t('mode.hint')}
            error={fields?.mode ? tAll(fields.mode) : undefined}
          />
          <MovementField
            label={t('fields.reminderDays')}
            hint={t('reminderDaysHint')}
            error={fields?.reminderDays}
          >
            {(control) => (
              <Input
                name="reminderDays"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                defaultValue={initial?.reminderDays ?? String(REMINDER_DAYS_DEFAULT)}
                {...control}
              />
            )}
          </MovementField>
          <FormActions>
            <Button type="submit" disabled={pending}>
              {pending ? t('actions.saving') : editing ? t('actions.save') : t('actions.create')}
            </Button>
            {cancel}
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}

function TranslatedAlert({ path }: { path: string }) {
  const t = useTranslations();
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{t(path)}</AlertDescription>
    </Alert>
  );
}
