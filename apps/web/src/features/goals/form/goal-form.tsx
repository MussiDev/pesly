'use client';

import { ACCOUNT_CURRENCIES, GOAL_NAME_MAX_LENGTH } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';
import { Link } from '@/i18n/navigation';
import type { GoalFieldErrors, GoalFormState } from '../helpers/goal-request';
import { GoalAccountSelect, type GoalAccountsState } from './goal-account-select';

export interface GoalFormErrors {
  fields?: GoalFieldErrors;
  /** A full catalog path. */
  form?: string;
}

export interface GoalFormInitial {
  name: string;
  /** Already formatted for the locale. */
  targetAmount: string;
  targetDate: string;
}

interface GoalFormProps {
  mode: 'create' | 'edit';
  initial?: GoalFormInitial;
  /** Edit mode shows the currency and the link here instead of controls. */
  readOnly?: ReactNode;
  accounts?: GoalAccountsState;
  onLinkChange?: (linked: boolean) => void;
  pending: boolean;
  errors: GoalFormErrors;
  cancelHref: string;
  onSubmit: (state: GoalFormState) => void;
}

/** Name, target amount and date, plus the currency and optional account link when creating. */
export function GoalForm({
  mode,
  initial,
  readOnly,
  accounts = { kind: 'idle' },
  onLinkChange,
  pending,
  errors,
  cancelHref,
  onSubmit,
}: GoalFormProps) {
  const t = useTranslations('goals.form');
  const tAll = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);
  const [currency, setCurrency] = useState<GoalFormState['currency']>('ARS');
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');
  const [linked, setLinked] = useState(false);
  const [accountId, setAccountId] = useState('');

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
      targetAmount: readField(form, 'targetAmount'),
      currency,
      targetDate,
      accountId: linked ? accountId : '',
    });
  }

  function changeLink(next: boolean) {
    setLinked(next);
    if (!next) setAccountId('');
    onLinkChange?.(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{mode === 'create' ? t('createTitle') : t('editTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-4">
          {errors.form ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{tAll(errors.form)}</AlertDescription>
            </Alert>
          ) : null}
          <MovementField label={t('name')} error={errors.fields?.name}>
            {(control) => (
              <Input
                name="name"
                autoComplete="off"
                defaultValue={initial?.name}
                maxLength={GOAL_NAME_MAX_LENGTH * 2}
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('targetAmount')} error={errors.fields?.targetAmount}>
            {(control) => (
              <MoneyInput name="targetAmount" defaultValue={initial?.targetAmount} {...control} />
            )}
          </MovementField>
          {mode === 'create' ? (
            <MovementField label={t('currency')} error={undefined}>
              {(control) => (
                <Select
                  name="currency"
                  value={currency}
                  onChange={(event) => {
                    setCurrency(event.currentTarget.value as GoalFormState['currency']);
                    setAccountId('');
                  }}
                  {...control}
                >
                  {ACCOUNT_CURRENCIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              )}
            </MovementField>
          ) : null}
          <MovementField label={t('targetDate')} error={errors.fields?.targetDate}>
            {(control) => (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  name="targetDate"
                  value={targetDate}
                  onChange={(event) => {
                    setTargetDate(event.currentTarget.value);
                  }}
                  className="w-auto flex-1"
                  {...control}
                />
                {targetDate === '' ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setTargetDate('');
                    }}
                  >
                    {t('clearTargetDate')}
                  </Button>
                )}
              </div>
            )}
          </MovementField>
          {mode === 'create' ? (
            <div className="grid gap-3">
              <div className="flex min-h-11 items-center gap-3">
                <Checkbox
                  id="goal-link"
                  checked={linked}
                  onChange={(event) => {
                    changeLink(event.currentTarget.checked);
                  }}
                />
                <Label htmlFor="goal-link">{t('account')}</Label>
              </div>
              {linked ? (
                <GoalAccountSelect
                  accounts={accounts}
                  currency={currency}
                  value={accountId}
                  onChange={setAccountId}
                />
              ) : null}
            </div>
          ) : (
            readOnly
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? t('saving') : t('submit')}
            </Button>
            <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
              {t('cancel')}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
