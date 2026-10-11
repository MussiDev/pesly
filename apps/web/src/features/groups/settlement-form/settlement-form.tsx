'use client';

import { ACCOUNT_CURRENCIES } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  MovementField,
  type MovementFieldControlProps,
} from '@/features/movements/components/movement-field';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from '../components/group-issue';
import type {
  SettlementFieldErrors,
  SettlementFormValues,
} from '../settlements/settlement-request';
import { SettlementAccountField, type SettlementAccountsState } from './settlement-account-field';
import { SettlementDirectionSummary, type SettlementSummary } from './settlement-direction-summary';

export interface MemberOption {
  id: string;
  name: string;
}

interface SettlementFormProps {
  values: SettlementFormValues;
  members: MemberOption[];
  errors: SettlementFieldErrors;
  issue?: ApiFailure;
  notFound: boolean;
  pending: boolean;
  summary: SettlementSummary | null;
  /** `null` when the caller is not a party: the field is not rendered at all. */
  accounts: SettlementAccountsState | null;
  onChange: (name: keyof SettlementFormValues, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onRetryAccounts: () => void;
}

/** Who pays whom, how much, in which currency and when; presentational only. */
export function SettlementForm({
  values,
  members,
  errors,
  issue,
  notFound,
  pending,
  summary,
  accounts,
  onChange,
  onSubmit,
  onCancel,
  onRetryAccounts,
}: SettlementFormProps) {
  const t = useTranslations('groups.settlement');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  const memberSelect =
    (name: 'fromMemberId' | 'toMemberId') => (control: MovementFieldControlProps) => (
      <Select
        name={name}
        value={values[name]}
        onChange={(event) => {
          onChange(name, event.currentTarget.value);
        }}
        {...control}
      >
        <option value="">{t('memberPlaceholder')}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-4">
          {notFound ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{t('notFound')}</AlertDescription>
            </Alert>
          ) : issue ? (
            <GroupIssue failure={issue} />
          ) : null}
          <SettlementDirectionSummary summary={summary} />
          <MovementField label={t('fields.from')} error={errors.fromMember}>
            {memberSelect('fromMemberId')}
          </MovementField>
          <MovementField label={t('fields.to')} error={errors.toMember}>
            {memberSelect('toMemberId')}
          </MovementField>
          <MovementField label={t('fields.currency')} error={errors.currency}>
            {(control) => (
              <Select
                name="currency"
                value={values.currency}
                onChange={(event) => {
                  onChange('currency', event.currentTarget.value);
                }}
                {...control}
              >
                {ACCOUNT_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
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
          {accounts === null ? null : (
            <SettlementAccountField
              state={accounts}
              value={values.accountId}
              error={errors.account}
              onChange={(accountId) => {
                onChange('accountId', accountId);
              }}
              onRetry={onRetryAccounts}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t('pending') : t('submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
