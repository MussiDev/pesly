'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Select } from '@/components/ui/select';
import {
  CategoryChips,
  type CategoryChipOption,
} from '@/features/movements/components/category-chips';
import { MovementField } from '@/features/movements/components/movement-field';

interface PayerAccountFieldsProps {
  /** The caller's accounts in the expense currency. */
  accounts: readonly { id: string; name: string }[];
  categories: readonly CategoryChipOption[];
  accountId: string;
  categoryId: string;
  accountError: string | undefined;
  categoryError: string | undefined;
  onAccountChange: (id: string) => void;
  onCategoryChange: (id: string) => void;
}

/** Where the money left and under which personal category, asked only when the caller pays. */
export function PayerAccountFields({
  accounts,
  categories,
  accountId,
  categoryId,
  accountError,
  categoryError,
  onAccountChange,
  onCategoryChange,
}: PayerAccountFieldsProps) {
  const t = useTranslations('groups.expenses.form');
  const tAll = useTranslations();
  const categoryErrorId = useId();
  const noAccounts = accounts.length === 0;

  return (
    <fieldset className="grid gap-4">
      <legend className="mb-2 text-small font-semibold">{t('steps.payerAccount')}</legend>
      <p className="text-small text-muted-foreground">{t('payerAccountHint')}</p>
      {noAccounts ? (
        <p role="alert" className="text-small text-destructive">
          {t('errors.noAccountInCurrency')}
        </p>
      ) : null}
      <MovementField label={t('fields.account')} error={noAccounts ? undefined : accountError}>
        {(control) => (
          <Select
            value={accountId}
            disabled={noAccounts}
            onChange={(event) => {
              onAccountChange(event.currentTarget.value);
            }}
            {...control}
          >
            <option value="">{t('placeholders.account')}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        )}
      </MovementField>
      <div className="grid min-w-0 gap-2">
        {/* Your own expense category: the same icon grid as a personal expense. */}
        <CategoryChips
          label={t('fields.personalCategory')}
          name="personalCategoryId"
          categories={categories}
          defaultValue=""
          value={categoryId}
          onChange={onCategoryChange}
          invalid={Boolean(categoryError)}
          describedBy={categoryError ? `${categoryErrorId}-message` : undefined}
        />
        {categoryError ? (
          <p id={`${categoryErrorId}-message`} className="text-small text-destructive">
            {tAll(categoryError)}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
