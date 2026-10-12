'use client';

import {
  parseAmountInput,
  type AccountCurrency,
  type AccountResponse,
  type GroupMemberResponse,
} from '@pesly/shared';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import type { ApiFailure } from '@/lib/api-client';
import { formatMoney } from '@/lib/format-amount';
import {
  buildSettlementRequest,
  prefillSettlement,
  type SettlementFieldErrors,
  type SettlementFormValues,
  type SuggestedPayment,
} from '../settlements/settlement-request';
import type { SettlementAccountsState } from './settlement-account-field';
import { SettlementForm } from './settlement-form';
import type { SettlementSummary } from './settlement-direction-summary';

/** A suggested payment to start from: who pays whom, in which currency, how much. */
export type SettlementPrefill = SuggestedPayment & { currency: AccountCurrency };

interface SettlementFormContainerProps {
  groupId: string;
  selfMemberId: string;
  /** The active members of the group: the only ones that can be chosen. */
  members: GroupMemberResponse[];
  /** `null` opens an empty form. */
  initial: SettlementPrefill | null;
  /** The settlement was recorded: the page reloads the balances and closes the form. */
  onRecorded: () => void;
  onCancel: () => void;
}

type LoadedAccounts =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; items: AccountResponse[] };

/** Records one payment between two members. Online only; nothing is queued. */
export function SettlementFormContainer({
  groupId,
  selfMemberId,
  members,
  initial,
  onRecorded,
  onCancel,
}: SettlementFormContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.detail');
  const locale = useLocale();
  const language = locale === 'en' ? 'en' : 'es';
  const timeZone = useTimeZone() ?? 'UTC';

  const [values, setValues] = useState<SettlementFormValues>(() =>
    prefillSettlement(initial, initial?.currency ?? 'ARS', {
      locale,
      timeZone,
      now: new Date(),
    }),
  );
  const [errors, setErrors] = useState<SettlementFieldErrors>({});
  const [issue, setIssue] = useState<ApiFailure>();
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  const [accounts, setAccounts] = useState<LoadedAccounts>({ kind: 'idle' });
  // A ref, not state: a second click in the same tick must see the first one.
  const locked = useRef(false);
  const accountsRequested = useRef(false);

  const isParty = values.fromMemberId === selfMemberId || values.toMemberId === selfMemberId;

  const options = useMemo(
    () =>
      accounts.kind === 'ready'
        ? accounts.items
            .filter(
              (account) =>
                !account.archived &&
                account.type !== 'credit_card' &&
                account.currency === values.currency,
            )
            .map((account) => ({ id: account.id, name: account.name }))
        : [],
    [accounts, values.currency],
  );

  const loadAccounts = useCallback(async () => {
    setAccounts({ kind: 'loading' });
    const result = await api.listAccounts({ archived: false, limit: 100 });
    if (result.ok) setAccounts({ kind: 'ready', items: result.data.items });
    else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setAccounts({ kind: 'failed' });
  }, [api, router]);

  // Once per opening, and only when the caller is a party.
  useEffect(() => {
    if (!isParty || accountsRequested.current) return;
    accountsRequested.current = true;
    void loadAccounts();
  }, [isParty, loadAccounts]);

  const nameOf = useCallback(
    (id: string): string | null => {
      const found = members.find((member) => member.id === id);
      return found === undefined ? null : (found.displayName ?? t('unnamed'));
    },
    [members, t],
  );

  const memberOptions = members.map((member) => ({
    id: member.id,
    name: member.displayName ?? t('unnamed'),
  }));

  const summary = useMemo((): SettlementSummary | null => {
    const payer = nameOf(values.fromMemberId);
    const payee = nameOf(values.toMemberId);
    const amount = parseAmountInput(values.amount, locale);
    const currency = values.currency === 'USD' ? 'USD' : 'ARS';
    if (payer === null || payee === null || amount === null || amount <= 0n) return null;
    return { payer, payee, amount: formatMoney(amount, currency, language) };
  }, [nameOf, values, locale, language]);

  function change(name: keyof SettlementFormValues, value: string) {
    const next = { ...values, [name]: value };
    const stillParty = next.fromMemberId === selfMemberId || next.toMemberId === selfMemberId;
    const fits =
      stillParty &&
      accounts.kind === 'ready' &&
      accounts.items.some(
        (account) =>
          account.id === next.accountId &&
          account.currency === next.currency &&
          !account.archived &&
          account.type !== 'credit_card',
      );
    if (!fits) next.accountId = '';
    setValues(next);
  }

  async function submit() {
    if (locked.current) return;
    const result = buildSettlementRequest(values, {
      memberIds: members.map((member) => member.id),
      selfMemberId,
      accountIds: options.map((option) => option.id),
      timeZone,
      locale,
      now: new Date(),
    });
    if (result.request === undefined) {
      setErrors(result.fields);
      return;
    }
    setErrors({});
    setIssue(undefined);
    setNotFound(false);
    locked.current = true;
    setPending(true);
    const response = await api.createSettlement(groupId, result.request);
    if (response.ok) {
      // Stays locked: the form is about to close and must not record twice.
      onRecorded();
      return;
    }
    locked.current = false;
    setPending(false);
    if (response.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else if (response.code === 'NOT_FOUND') setNotFound(true);
    else {
      if (response.code === 'GROUP_SETTLEMENT_ACCOUNT_INVALID') {
        setValues((current) => ({ ...current, accountId: '' }));
      }
      setIssue(response);
    }
  }

  let accountsView: SettlementAccountsState | null = null;
  if (isParty) {
    accountsView =
      accounts.kind === 'ready'
        ? { kind: 'ready', options }
        : accounts.kind === 'failed'
          ? { kind: 'failed' }
          : { kind: 'loading' };
  }

  return (
    <SettlementForm
      values={values}
      members={memberOptions}
      errors={errors}
      issue={issue}
      notFound={notFound}
      pending={pending}
      summary={summary}
      accounts={accountsView}
      onChange={change}
      onSubmit={() => {
        void submit();
      }}
      onCancel={onCancel}
      onRetryAccounts={() => {
        void loadAccounts();
      }}
    />
  );
}
