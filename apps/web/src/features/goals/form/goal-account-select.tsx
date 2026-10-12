'use client';

import type { AccountResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/select';
import { MovementField } from '@/features/movements/components/movement-field';

export type GoalAccountsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; accounts: AccountResponse[] };

interface GoalAccountSelectProps {
  accounts: GoalAccountsState;
  currency: string;
  value: string;
  onChange: (accountId: string) => void;
  /** A full catalog path. */
  error?: string;
}

/** The active accounts in the goal's currency; the empty value means no link. */
export function GoalAccountSelect({
  accounts,
  currency,
  value,
  onChange,
  error,
}: GoalAccountSelectProps) {
  const t = useTranslations('goals.form');
  const tAll = useTranslations();

  if (accounts.kind === 'idle') return null;
  if (accounts.kind === 'loading') {
    return (
      <p role="status" className="text-small text-muted-foreground">
        {tAll('app.loading')}
      </p>
    );
  }
  if (accounts.kind === 'failed') {
    return (
      <>
        <p role="alert" className="text-small text-destructive">
          {tAll(accounts.message)}
        </p>
        {error ? <p className="text-small text-destructive">{tAll(error)}</p> : null}
      </>
    );
  }

  const options = accounts.accounts.filter(
    (account) => !account.archived && account.currency === currency,
  );
  if (options.length === 0) {
    return (
      <>
        <p className="text-small text-muted-foreground">{t('noAccounts')}</p>
        {error ? <p className="text-small text-destructive">{tAll(error)}</p> : null}
      </>
    );
  }

  return (
    <MovementField label={t('account')} error={error}>
      {(control) => (
        <Select
          name="accountId"
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
          {...control}
        >
          <option value="">{t('accountNone')}</option>
          {options.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      )}
    </MovementField>
  );
}
