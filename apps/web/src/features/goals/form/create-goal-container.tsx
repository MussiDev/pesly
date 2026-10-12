'use client';

import { useLocale } from 'next-intl';
import { useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { buildCreateGoal, type GoalFormState } from '../helpers/goal-request';
import { formFailureMessage } from './form-failure';
import type { GoalAccountsState } from './goal-account-select';
import { GoalForm, type GoalFormErrors } from './goal-form';

/** The new goal screen. Online only; the accounts load only when the user chooses to link one. */
export function CreateGoalContainer() {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [accounts, setAccounts] = useState<GoalAccountsState>({ kind: 'idle' });

  async function loadAccounts() {
    setAccounts({ kind: 'loading' });
    const result = await api.listAccounts({ archived: false, limit: 100 });
    if (result.ok) {
      setAccounts({ kind: 'ready', accounts: result.data.items });
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else {
      setAccounts({ kind: 'failed', message: formFailureMessage(result) });
    }
  }

  function changeLink(linked: boolean) {
    if (linked && (accounts.kind === 'idle' || accounts.kind === 'failed')) void loadAccounts();
  }

  async function save(state: GoalFormState) {
    if (sending.current) return;
    const built = buildCreateGoal(state, locale);
    if (built.request === undefined) {
      setErrors({ fields: built.errors });
      return;
    }
    sending.current = true;
    setPending(true);
    setErrors({});
    const result = await api.createGoal(built.request);
    if (result.ok) {
      router.push('/goals');
      return;
    }
    sending.current = false;
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    // The form stays mounted, so everything the user entered is still there for a retry.
    else setErrors({ form: formFailureMessage(result) });
  }

  return (
    <GoalForm
      mode="create"
      accounts={accounts}
      onLinkChange={changeLink}
      pending={pending}
      errors={errors}
      cancelHref="/goals"
      onSubmit={(state) => {
        void save(state);
      }}
    />
  );
}
