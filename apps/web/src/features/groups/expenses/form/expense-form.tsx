'use client';

import { parseAmountInput, type GroupSplitMode } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { MovementField } from '@/features/movements/components/movement-field';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from '../../components/group-issue';
import {
  buildSplit,
  exactRemaining,
  percentageTotal,
  previewShares,
} from '../../split/split-request';
import { switchSplitMode } from '../../split/split-state';
import { EqualSplitFields } from './equal-split-fields';
import { ExactSplitFields } from './exact-split-fields';
import {
  eligibleAccounts,
  effectiveSplitState,
  type ExpenseFieldErrors,
  type ExpenseFormValues,
} from './expense-request';
import { PayerAccountFields } from './payer-account-fields';
import { PercentageSplitFields } from './percentage-split-fields';
import { SplitModePicker } from './split-mode-picker';
import { SplitSummary } from './split-summary';

const CURRENCIES = ['ARS', 'USD'] as const;

export interface ExpenseFormProps {
  members: readonly { id: string; name: string }[];
  /** The group's categories that can still be used. */
  categories: readonly { id: string; label: string }[];
  /** The caller's accounts. */
  accounts: readonly { id: string; name: string; currency: string; archived: boolean }[];
  personalCategories: readonly { id: string; label: string }[];
  currentMemberId: string | undefined;
  initialValues: ExpenseFormValues;
  /** Messages of the last refused submit, per field. */
  fieldErrors: ExpenseFieldErrors;
  /** Why the server refused the last submit; the entered values stay. */
  issue: ApiFailure | undefined;
  pending: boolean;
  onSubmit: (values: ExpenseFormValues) => void;
  /**
   * Edit mode: the currency and the payer cannot change, so they show as text and the payer
   * account fields are left out. Absent, the form is the creation form.
   */
  locked?: { payerName: string };
}

/** A value the person can see but not change (edit mode). */
function LockedValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-small font-medium">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function toCurrency(value: string): 'ARS' | 'USD' {
  return CURRENCIES.find((currency) => currency === value) ?? 'ARS';
}

/** One field group per step: amount, date and payer, category and description, split. */
export function ExpenseForm({
  members,
  categories,
  accounts,
  personalCategories,
  currentMemberId,
  initialValues,
  fieldErrors,
  issue,
  pending,
  onSubmit,
  locked,
}: ExpenseFormProps) {
  const t = useTranslations('groups.expenses.form');
  const tEdit = useTranslations('groups.edit.expense');
  const tSplit = useTranslations('groups.split');
  const tAll = useTranslations();
  const locale = useLocale();
  const language = locale === 'en' ? 'en' : 'es';
  const [values, setValues] = useState(initialValues);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors]);

  const memberIds = members.map((member) => member.id);
  const currency = toCurrency(values.currency);
  const parsedAmount = parseAmountInput(values.amount, locale);
  const amount = parsedAmount !== null && parsedAmount > 0n ? parsedAmount : 0n;
  const effective = effectiveSplitState(values, memberIds, amount);
  const live = buildSplit(effective, amount, values.payerMemberId, locale);
  const blocked = amount > 0n && !live.ok;
  const memberErrors: Record<string, string> = {};
  let wholeError: string | undefined;
  if (!live.ok && amount > 0n) {
    for (const error of live.errors) {
      if (error.memberId !== null) memberErrors[error.memberId] = error.path;
      else if (live.difference === null) wholeError = error.path;
    }
  }

  const payerIsCaller =
    locked === undefined &&
    currentMemberId !== undefined &&
    values.payerMemberId === currentMemberId;
  const usableAccounts = eligibleAccounts(accounts, values.currency);

  function update(patch: Partial<ExpenseFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function changeCurrency(next: string) {
    const stillUsable = eligibleAccounts(accounts, next).some(
      (a) => a.id === values.payerAccountId,
    );
    update({ currency: next, ...(stillUsable ? {} : { payerAccountId: '' }) });
  }

  function changeMode(mode: GroupSplitMode) {
    update({ split: switchSplitMode(values.split, mode) });
  }

  function toggleMember(memberId: string) {
    const selected = new Set(values.split.selectedMemberIds);
    if (selected.has(memberId)) selected.delete(memberId);
    else selected.add(memberId);
    update({
      split: { ...values.split, selectedMemberIds: memberIds.filter((id) => selected.has(id)) },
    });
  }

  function changeMemberValue(memberId: string, text: string) {
    update({ split: { ...values.split, values: { ...values.split.values, [memberId]: text } } });
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blocked) return;
    onSubmit(values);
  }

  const submitKey = pending ? 'pending' : 'submit';
  const submitLabel = locked ? tEdit(submitKey) : t(submitKey);

  const shares =
    values.split.mode === 'equal' && amount > 0n
      ? previewShares(effective, amount, values.payerMemberId, locale)
      : null;
  const shareMap = shares === null ? null : new Map(shares.map((s) => [s.memberId, s.amount]));

  return (
    <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-6">
      {issue ? <GroupIssue failure={issue} /> : null}

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-small font-semibold">{t('steps.amount')}</legend>
        <MovementField label={t('fields.amount')} error={fieldErrors.amount}>
          {(control) => (
            <MoneyInput
              value={values.amount}
              onChange={(event) => {
                update({ amount: event.currentTarget.value });
              }}
              {...control}
            />
          )}
        </MovementField>
        {locked ? (
          <LockedValue label={t('fields.currency')} value={values.currency} />
        ) : (
          <MovementField label={t('fields.currency')} error={fieldErrors.currency}>
            {(control) => (
              <Select
                value={values.currency}
                onChange={(event) => {
                  changeCurrency(event.currentTarget.value);
                }}
                {...control}
              >
                {CURRENCIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
        )}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-small font-semibold">{t('steps.payer')}</legend>
        <MovementField label={t('fields.date')} error={fieldErrors.occurredAt}>
          {(control) => (
            <Input
              type="datetime-local"
              value={values.occurredAt}
              onChange={(event) => {
                update({ occurredAt: event.currentTarget.value });
              }}
              {...control}
            />
          )}
        </MovementField>
        {locked ? (
          <LockedValue label={t('fields.payer')} value={locked.payerName} />
        ) : (
          <MovementField label={t('fields.payer')} error={fieldErrors.payer}>
            {(control) => (
              <Select
                value={values.payerMemberId}
                onChange={(event) => {
                  update({ payerMemberId: event.currentTarget.value });
                }}
                {...control}
              >
                <option value="">{t('placeholders.payer')}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
        )}
        {payerIsCaller ? (
          <PayerAccountFields
            accounts={usableAccounts}
            categories={personalCategories}
            accountId={values.payerAccountId}
            categoryId={values.payerCategoryId}
            accountError={fieldErrors.payerAccount}
            categoryError={fieldErrors.payerCategory}
            onAccountChange={(id) => {
              update({ payerAccountId: id });
            }}
            onCategoryChange={(id) => {
              update({ payerCategoryId: id });
            }}
          />
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-small font-semibold">{t('steps.details')}</legend>
        <MovementField label={t('fields.category')} error={fieldErrors.category}>
          {(control) => (
            <Select
              value={values.categoryId}
              onChange={(event) => {
                update({ categoryId: event.currentTarget.value });
              }}
              {...control}
            >
              <option value="">{t('placeholders.category')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
          )}
        </MovementField>
        <MovementField label={t('fields.description')} error={fieldErrors.description}>
          {(control) => (
            <Input
              autoComplete="off"
              value={values.description}
              onChange={(event) => {
                update({ description: event.currentTarget.value });
              }}
              {...control}
            />
          )}
        </MovementField>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-small font-semibold">{tSplit('title')}</legend>
        <SplitModePicker mode={values.split.mode} onChange={changeMode} />
        {values.split.mode === 'equal' ? (
          <EqualSplitFields
            members={members}
            selectedIds={values.split.selectedMemberIds}
            shares={shareMap}
            currency={currency}
            language={language}
            onToggle={toggleMember}
          />
        ) : values.split.mode === 'percentage' ? (
          <>
            <PercentageSplitFields
              members={members}
              values={values.split.values}
              errors={memberErrors}
              onChange={changeMemberValue}
            />
            <SplitSummary
              mode="percentage"
              difference={percentageTotal(effective)}
              currency={currency}
              language={language}
            />
          </>
        ) : (
          <>
            <ExactSplitFields
              members={members}
              values={values.split.values}
              errors={memberErrors}
              onChange={changeMemberValue}
            />
            {amount > 0n ? (
              <SplitSummary
                mode="exact"
                difference={exactRemaining(effective, amount, locale)}
                currency={currency}
                language={language}
              />
            ) : null}
          </>
        )}
        {wholeError ? (
          <p role="alert" className="text-small text-destructive">
            {tAll(wholeError)}
          </p>
        ) : null}
      </fieldset>

      <div>
        <Button type="submit" disabled={pending || blocked}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
