'use client';

import { MOVEMENT_TYPES, type MovementType, type RateType } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { FormAlert } from '@/features/auth/components/form-alert';
import { readField } from '@/features/auth/read-field';
import { Link } from '@/i18n/navigation';
import type { MovementFormErrors } from '../movement-form-errors';
import { MovementField } from './movement-field';
import { RateField } from './rate-field';

/** What the user typed or picked, untouched: the container parses and validates it. */
export interface MovementFormValues {
  type: string;
  accountId: string;
  categoryId: string;
  amount: string;
  /** `YYYY-MM-DDTHH:mm`, the wall-clock time in the user's time zone. */
  occurredAt: string;
  rate: string;
  /** `true` once the user typed in the rate field, even if the text ended up the same. */
  rateEdited: boolean;
  note: string;
}

export interface MovementAccountOption {
  id: string;
  name: string;
  currency: string;
}

export interface MovementCategoryOption {
  id: string;
  kind: MovementType;
  label: string;
}

export interface MovementFormProps {
  accounts: readonly MovementAccountOption[];
  /** Usable (non-archived) categories of both types; the form shows the ones of the chosen type. */
  categories: readonly MovementCategoryOption[];
  defaultOccurredAt: string;
  defaultRate: string;
  rateType: RateType | undefined;
  rateAgeHours: number | undefined;
  pending: boolean;
  errors: MovementFormErrors;
  onSubmit: (values: MovementFormValues) => void;
}

function toMovementType(value: string): MovementType {
  return MOVEMENT_TYPES.find((type) => type === value) ?? 'expense';
}

export function MovementForm({
  accounts,
  categories,
  defaultOccurredAt,
  defaultRate,
  rateType,
  rateAgeHours,
  pending,
  errors,
  onSubmit,
}: MovementFormProps) {
  const t = useTranslations('movements');
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<MovementType>('expense');
  const [rateEdited, setRateEdited] = useState(false);

  // After a failed submit, focus the first invalid field so its message is announced with it.
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function handleTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    setType(toMovementType(event.currentTarget.value));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      type,
      accountId: readField(form, 'accountId'),
      categoryId: readField(form, 'categoryId'),
      amount: readField(form, 'amount'),
      occurredAt: readField(form, 'occurredAt'),
      rate: readField(form, 'rate'),
      rateEdited,
      note: readField(form, 'note'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('new.title')}</CardTitle>
        <CardDescription>{t('new.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <RateLimitAlert rateLimit={errors.rateLimit} />
          <MovementField label={t('fields.type')} error={errors.fields?.type}>
            {(control) => (
              <Select name="type" value={type} onChange={handleTypeChange} {...control}>
                {MOVEMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`types.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
          <MovementField label={t('fields.account')} error={errors.fields?.account}>
            {(control) => (
              <Select name="accountId" defaultValue="" required {...control}>
                <option value="">{t('fields.accountPlaceholder')}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {`${account.name} (${account.currency})`}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
          <MovementField label={t('fields.category')} error={errors.fields?.category}>
            {(control) => (
              // Keyed by type so the picked category resets when the type changes.
              <Select key={type} name="categoryId" defaultValue="" required {...control}>
                <option value="">{t('fields.categoryPlaceholder')}</option>
                {categories
                  .filter((category) => category.kind === type)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
              </Select>
            )}
          </MovementField>
          <MovementField label={t('fields.amount')} error={errors.fields?.amount}>
            {(control) => <MoneyInput name="amount" required {...control} />}
          </MovementField>
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
          <RateField
            defaultValue={defaultRate}
            rateType={rateType}
            ageHours={rateAgeHours}
            error={errors.fields?.rate}
            onEdited={() => {
              setRateEdited(true);
            }}
          />
          <MovementField label={t('fields.note')} error={errors.fields?.note}>
            {(control) => <Input name="note" type="text" autoComplete="off" {...control} />}
          </MovementField>
          <Button type="submit" disabled={pending}>
            {pending ? t('form.pending') : t('form.submit')}
          </Button>
          <Link href="/movements" className={buttonVariants({ variant: 'ghost' })}>
            {t('form.back')}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}

function RateLimitAlert({ rateLimit }: { rateLimit: MovementFormErrors['rateLimit'] }) {
  const t = useTranslations('movements.errors');
  if (!rateLimit) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>
        {rateLimit.seconds === undefined
          ? t('rateLimitedGeneric')
          : t('rateLimited', { seconds: rateLimit.seconds })}
      </AlertDescription>
    </Alert>
  );
}
