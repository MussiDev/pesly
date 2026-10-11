'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/select';
import { MovementField } from '@/features/movements/components/movement-field';

interface PayerAccountFieldsProps {
  /** The caller's accounts in the expense currency. */
  accounts: readonly { id: string; name: string }[];
  categories: readonly { id: string; label: string }[];
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
      <MovementField label={t('fields.personalCategory')} error={categoryError}>
        {(control) => (
          <Select
            value={categoryId}
            onChange={(event) => {
              onCategoryChange(event.currentTarget.value);
            }}
            {...control}
          >
            <option value="">{t('placeholders.personalCategory')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        )}
      </MovementField>
    </fieldset>
  );
}
