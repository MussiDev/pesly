'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { MovementField } from '@/features/movements/components/movement-field';

export interface AccountOption {
  id: string;
  name: string;
}

export type SettlementAccountsState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; options: AccountOption[] };

interface SettlementAccountFieldProps {
  state: SettlementAccountsState;
  value: string;
  error?: string;
  onChange: (accountId: string) => void;
  onRetry: () => void;
}

/** The caller's own account that the cash goes to or comes from; "none" is always there. */
export function SettlementAccountField({
  state,
  value,
  error,
  onChange,
  onRetry,
}: SettlementAccountFieldProps) {
  const t = useTranslations('groups.settlement');
  const options = state.kind === 'ready' ? state.options : [];

  return (
    <div className="grid gap-2">
      <MovementField
        label={t('fields.account')}
        hint={state.kind === 'loading' ? t('accountsLoading') : t('accountHint')}
        error={error}
      >
        {(control) => (
          <Select
            name="accountId"
            value={value}
            disabled={state.kind === 'loading'}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
            {...control}
          >
            <option value="">{t('accountNone')}</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        )}
      </MovementField>
      {state.kind === 'failed' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-small text-destructive">
            {t('accountsFailed')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('accountsRetry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
