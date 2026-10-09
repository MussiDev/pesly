'use client';

import { renameAccountRequestSchema, type AccountResponse } from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { nameErrorMessage, type AccountFieldMessage } from '../account-form-errors';
import { buildOpeningBalanceRequest } from '../opening-balance-request';
import type { CurrencyTotals } from '../totals';
import { AccountList } from '../components/account-list';
import { AccountsLoadStateView, type AccountsLoadState } from '../components/accounts-load-state';

/** The API's largest page; there is no pagination control yet (personal scale). */
const PAGE_SIZE = 100;

type ListState =
  | AccountsLoadState
  | {
      kind: 'ready';
      accounts: AccountResponse[];
      availableTotals: CurrencyTotals;
      netWorthTotals: CurrencyTotals;
      debtTotals: CurrencyTotals;
      creditCardCount: number;
    };

/**
 * Lists the active or the archived accounts and runs the row actions. After an action the row
 * leaves the view at once and the list is read again, so balances and totals stay the API's.
 */
export function AccountsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [showArchived, setShowArchived] = useState(false);
  // `silent` reloads (after an action) keep the list on screen and report failures as an alert.
  const [request, setRequest] = useState({ id: 0, silent: false });
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | undefined>();
  const [blockedDeleteId, setBlockedDeleteId] = useState<string | undefined>();
  const [renameError, setRenameError] = useState<AccountFieldMessage | undefined>();
  const [editingOpeningId, setEditingOpeningId] = useState<string | undefined>();
  const [openingError, setOpeningError] = useState<AccountFieldMessage | undefined>();
  const [actionError, setActionError] = useState<ErrorMessageKey | undefined>();

  useEffect(() => {
    let active = true;
    void api.listAccounts({ archived: showArchived, limit: PAGE_SIZE }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setState({
          kind: 'ready',
          accounts: result.data.items,
          availableTotals: result.data.availableTotals,
          netWorthTotals: result.data.netWorthTotals,
          debtTotals: result.data.debtTotals,
          creditCardCount: result.data.creditCardCount,
        });
      } else if (result.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
      } else if (request.silent) {
        setActionError(result.messageKey);
      } else {
        setState({ kind: 'failed', error: result.messageKey });
      }
    });
    return () => {
      active = false;
    };
  }, [api, router, showArchived, request]);

  function clearTransient() {
    setEditingId(undefined);
    setConfirmingDeleteId(undefined);
    setBlockedDeleteId(undefined);
    setRenameError(undefined);
    setEditingOpeningId(undefined);
    setOpeningError(undefined);
    setActionError(undefined);
  }

  function toggleArchived() {
    clearTransient();
    setState({ kind: 'loading' });
    setRequest((current) => ({ id: current.id + 1, silent: false }));
    setShowArchived((value) => !value);
  }

  function retry() {
    setState({ kind: 'loading' });
    setRequest((current) => ({ id: current.id + 1, silent: false }));
  }

  function leaveView(id: string) {
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, accounts: current.accounts.filter((account) => account.id !== id) }
        : current,
    );
    setRequest((current) => ({ id: current.id + 1, silent: true }));
  }

  /** `true` when the failure was handled here; otherwise the caller decides what to show. */
  function handleSharedFailure(failure: ApiFailure): boolean {
    if (failure.code !== 'UNAUTHENTICATED') return false;
    router.replace('/sign-in');
    return true;
  }

  async function rename(id: string, name: string) {
    const parsed = renameAccountRequestSchema.safeParse({ name });
    if (!parsed.success) {
      setRenameError(nameErrorMessage(name));
      return;
    }
    setPending(true);
    setRenameError(undefined);
    setActionError(undefined);
    const result = await api.renameAccount(id, { name: parsed.data.name });
    setPending(false);
    if (result.ok) {
      const renamed = result.data;
      setState((current) =>
        current.kind === 'ready'
          ? {
              ...current,
              accounts: current.accounts.map((account) => (account.id === id ? renamed : account)),
            }
          : current,
      );
      setEditingId(undefined);
    } else if (handleSharedFailure(result)) {
      return;
    } else if (result.code === 'ACCOUNT_NAME_TAKEN') {
      setRenameError('errors.accountNameTaken');
    } else {
      setActionError(result.messageKey);
    }
  }

  async function setOpeningBalance(id: string, text: string) {
    const built = buildOpeningBalanceRequest(text, locale);
    if (built.request === undefined) {
      setOpeningError(built.error);
      return;
    }
    setPending(true);
    setOpeningError(undefined);
    setActionError(undefined);
    const result = await api.setAccountOpeningBalance(id, built.request);
    setPending(false);
    if (result.ok) {
      const updated = result.data;
      setState((current) =>
        current.kind === 'ready'
          ? {
              ...current,
              accounts: current.accounts.map((account) => (account.id === id ? updated : account)),
            }
          : current,
      );
      setEditingOpeningId(undefined);
      // The totals are the API's: read them again instead of adding up on the client.
      setRequest((current) => ({ id: current.id + 1, silent: true }));
    } else if (!handleSharedFailure(result)) {
      setActionError(result.messageKey);
    }
  }

  async function setArchived(id: string, archived: boolean) {
    setPending(true);
    setActionError(undefined);
    const result = await (archived ? api.archiveAccount(id) : api.unarchiveAccount(id));
    setPending(false);
    if (result.ok) {
      setBlockedDeleteId(undefined);
      leaveView(id);
    } else if (!handleSharedFailure(result)) {
      setActionError(result.messageKey);
    }
  }

  async function toggleAvailable(id: string, includeInAvailable: boolean) {
    setPending(true);
    setActionError(undefined);
    const result = await api.setIncludeInAvailable(id, includeInAvailable);
    setPending(false);
    if (result.ok) {
      const updated = result.data;
      setState((current) =>
        current.kind === 'ready'
          ? {
              ...current,
              accounts: current.accounts.map((account) => (account.id === id ? updated : account)),
            }
          : current,
      );
      // The totals are the API's: read them again instead of adding up on the client.
      setRequest((current) => ({ id: current.id + 1, silent: true }));
    } else if (!handleSharedFailure(result)) {
      setActionError(result.messageKey);
    }
  }

  async function remove(id: string) {
    setPending(true);
    setActionError(undefined);
    const result = await api.deleteAccount(id);
    setPending(false);
    if (result.ok) {
      setConfirmingDeleteId(undefined);
      leaveView(id);
    } else if (handleSharedFailure(result)) {
      return;
    } else if (result.code === 'ACCOUNT_HAS_MOVEMENTS') {
      setConfirmingDeleteId(undefined);
      setBlockedDeleteId(id);
    } else {
      setActionError(result.messageKey);
    }
  }

  if (state.kind !== 'ready') {
    return <AccountsLoadStateView state={state} onRetry={retry} />;
  }

  return (
    <AccountList
      accounts={state.accounts}
      availableTotals={state.availableTotals}
      netWorthTotals={state.netWorthTotals}
      debtTotals={state.debtTotals}
      creditCardCount={state.creditCardCount}
      onToggleAvailable={(id, value) => {
        void toggleAvailable(id, value);
      }}
      showArchived={showArchived}
      pending={pending}
      editingId={editingId}
      confirmingDeleteId={confirmingDeleteId}
      blockedDeleteId={blockedDeleteId}
      renameError={renameError}
      editingOpeningId={editingOpeningId}
      openingError={openingError}
      onStartEditOpening={(id) => {
        clearTransient();
        setEditingOpeningId(id);
      }}
      onCancelEditOpening={() => {
        setEditingOpeningId(undefined);
        setOpeningError(undefined);
      }}
      onSetOpening={(id, text) => {
        void setOpeningBalance(id, text);
      }}
      actionError={actionError}
      onToggleArchived={toggleArchived}
      onStartRename={(id) => {
        clearTransient();
        setEditingId(id);
      }}
      onCancelRename={() => {
        setEditingId(undefined);
        setRenameError(undefined);
      }}
      onRename={(id, name) => {
        void rename(id, name);
      }}
      onArchive={(id) => {
        void setArchived(id, true);
      }}
      onUnarchive={(id) => {
        void setArchived(id, false);
      }}
      onAskDelete={(id) => {
        clearTransient();
        setConfirmingDeleteId(id);
      }}
      onCancelDelete={() => {
        setConfirmingDeleteId(undefined);
      }}
      onConfirmDelete={(id) => {
        void remove(id);
      }}
    />
  );
}
