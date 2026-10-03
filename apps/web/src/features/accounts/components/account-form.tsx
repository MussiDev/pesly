'use client';

import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_TYPES,
  defaultIncludeInAvailable,
  type AccountType,
} from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useId, useState, type ChangeEvent, type SubmitEvent } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormAlert } from '@/features/auth/components/form-alert';
import { readField } from '@/features/auth/read-field';
import { Link } from '@/i18n/navigation';
import type { AccountFormErrors } from '../account-form-errors';
import { useFocusFirstInvalid } from '../use-focus-first-invalid';
import { AccountField } from './account-field';

/** What the user typed or picked, untouched: the container parses and validates it. */
export interface AccountFormValues {
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  /** `undefined` for a credit card, which has no such setting. */
  includeInAvailable: boolean | undefined;
}

export interface AccountFormProps {
  pending: boolean;
  errors: AccountFormErrors;
  onSubmit: (values: AccountFormValues) => void;
}

function toAccountType(value: string): AccountType | undefined {
  return ACCOUNT_TYPES.find((type) => type === value);
}

export function AccountForm({ pending, errors, onSubmit }: AccountFormProps) {
  const t = useTranslations('accounts');
  const formRef = useFocusFirstInvalid(errors);
  const settingId = useId();
  const [type, setType] = useState<AccountType | undefined>();
  const [include, setInclude] = useState(false);
  // Until the user touches the checkbox it follows the default of the chosen type.
  const [touched, setTouched] = useState(false);
  const hasSetting = type !== undefined && type !== 'credit_card';

  function handleTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = toAccountType(event.currentTarget.value);
    setType(next);
    if (next !== undefined && !touched) setInclude(defaultIncludeInAvailable(next));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      name: readField(form, 'name'),
      type: readField(form, 'type'),
      currency: readField(form, 'currency'),
      openingBalance: readField(form, 'openingBalance'),
      includeInAvailable: hasSetting ? include : undefined,
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
          <AccountField label={t('fields.name')} error={errors.fields?.name}>
            {(control) => (
              <Input name="name" type="text" autoComplete="off" required {...control} />
            )}
          </AccountField>
          <AccountField label={t('fields.type')} error={errors.fields?.type}>
            {(control) => (
              <Select name="type" defaultValue="" required {...control} onChange={handleTypeChange}>
                <option value="">{t('fields.typePlaceholder')}</option>
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </Select>
            )}
          </AccountField>
          <AccountField label={t('fields.currency')} error={errors.fields?.currency}>
            {(control) => (
              <Select name="currency" defaultValue="" required {...control}>
                <option value="">{t('fields.currencyPlaceholder')}</option>
                {ACCOUNT_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {t(`currencies.${currency}`)}
                  </option>
                ))}
              </Select>
            )}
          </AccountField>
          <AccountField
            label={t('fields.openingBalance')}
            hint={t('fields.openingBalanceHint')}
            error={errors.fields?.openingBalance}
            max={errors.openingBalanceLimit}
          >
            {(control) => (
              <Input
                name="openingBalance"
                type="text"
                autoComplete="off"
                defaultValue="0"
                {...control}
              />
            )}
          </AccountField>
          {hasSetting ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={settingId}
                checked={include}
                onChange={(event) => {
                  setTouched(true);
                  setInclude(event.currentTarget.checked);
                }}
              />
              <Label htmlFor={settingId}>{t('fields.includeInAvailable')}</Label>
            </div>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? t('form.pending') : t('form.submit')}
          </Button>
          <Link href="/accounts" className={buttonVariants({ variant: 'ghost' })}>
            {t('form.back')}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
