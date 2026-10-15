'use client';

import {
  renameAccountRequestSchema,
  type AccountResponse,
  type SetAccountBalanceRequest,
} from '@pesly/shared';
import { useEffect, useState } from 'react';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { nameErrorMessage, type AccountFieldMessage } from '../account-form-errors';
import { ACCOUNT_GONE, mapSetBalanceFailure } from '../set-balance-failure';
import type { CurrencyTotals } from '../totals';
import { AccountList } from '../components/account-list';
import { AccountsLoadStateView, type AccountsLoadState } from '../components/accounts-load-state';
import {
  SetBalanceDialog,
  type SetBalanceFailure,
  type SetBalanceTwoFactor,
} from '../components/set-balance-dialog';

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

interface BalanceDialogState {
  id: string;
  twoFactor: SetBalanceTwoFactor;
  failure: SetBalanceFailure | undefined;
}

/**
 * Lists the active or the archived accounts and runs the row actions. After an action the row
 * leaves the view at once and the list is read again, so balances and totals stay the API's.
 */
export function AccountsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const online = useOnlineStatus();
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [showArchived, setShowArchived] = useState(false);
  // `silent` reloads (after an action) keep the list on screen and report failures as an alert.
  const [request, setRequest] = useState({ id: 0, silent: false });
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | undefined>();
  const [blockedDeleteId, setBlockedDeleteId] = useState<string | undefined>();
  const [renameError, setRenameError] = useState<AccountFieldMessage | undefined>();
  const [balanceDialog, setBalanceDialog] = useState<BalanceDialogState | undefined>();
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
    setBalanceDialog(undefined);
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

  /** Opens the dialog at once and reads whether 2FA is on, which decides if a code is asked. */
  async function startSetBalance(id: string) {
    clearTransient();
    setBalanceDialog({ id, twoFactor: 'loading', failure: undefined });
    const result = await api.getTwoFactorStatus();
    if (!result.ok && handleSharedFailure(result)) return;
    const next: Pick<BalanceDialogState, 'twoFactor' | 'failure'> = result.ok
      ? { twoFactor: result.data.enabled ? 'enabled' : 'disabled', failure: undefined }
      : {
          twoFactor: 'unavailable',
          failure: { field: 'form', message: `errors.${result.messageKey}` },
        };
    setBalanceDialog((current) => (current?.id === id ? { ...current, ...next } : current));
  }

  function closeBalanceDialog() {
    setBalanceDialog(undefined);
  }

  /** Re-reads the 2FA status so the code field appears (or goes) as the account now requires. */
  async function refreshTwoFactor(id: string) {
    const result = await api.getTwoFactorStatus();
    if (!result.ok) {
      handleSharedFailure(result);
      return;
    }
    const twoFactor = result.data.enabled ? 'enabled' : 'disabled';
    setBalanceDialog((current) => (current?.id === id ? { ...current, twoFactor } : current));
  }

  async function setBalance(id: string, body: SetAccountBalanceRequest) {
    setPending(true);
    setActionError(undefined);
    setBalanceDialog((current) =>
      current?.id === id ? { ...current, failure: undefined } : current,
    );
    const result = await api.setAccountBalance(id, body);
    setPending(false);
    if (result.ok) {
      const updated = result.data.account;
      setState((current) =>
        current.kind === 'ready'
          ? {
              ...current,
              accounts: current.accounts.map((account) => (account.id === id ? updated : account)),
            }
          : current,
      );
      closeBalanceDialog();
      // The totals are the API's: read them again instead of adding up on the client.
      setRequest((current) => ({ id: current.id + 1, silent: true }));
    } else if (handleSharedFailure(result)) {
      return;
    } else {
      const mapped = mapSetBalanceFailure(result);
      if (mapped === ACCOUNT_GONE) {
        closeBalanceDialog();
        setRequest((current) => ({ id: current.id + 1, silent: true }));
      } else {
        // A code refusal with no code field means 2FA was turned on after the dialog opened: say it
        // at form level (the field is not there to carry it) and read the status so the field shows.
        const staleTwoFactor = mapped.field === 'code' && balanceDialog?.twoFactor !== 'enabled';
        const failure: SetBalanceFailure = staleTwoFactor ? { ...mapped, field: 'form' } : mapped;
        setBalanceDialog((current) => (current?.id === id ? { ...current, failure } : current));
        if (staleTwoFactor) await refreshTwoFactor(id);
      }
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

  const dialogAccount = balanceDialog
    ? state.accounts.find((account) => account.id === balanceDialog.id)
    : undefined;

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
      settingBalanceId={dialogAccount?.id}
      balanceDialog={
        balanceDialog && dialogAccount ? (
          <SetBalanceDialog
            account={dialogAccount}
            twoFactor={balanceDialog.twoFactor}
            online={online}
            pending={pending}
            failure={balanceDialog.failure}
            onConfirm={(body) => {
              void setBalance(dialogAccount.id, body);
            }}
            onCancel={closeBalanceDialog}
          />
        ) : undefined
      }
      onStartSetBalance={(id) => {
        void startSetBalance(id);
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
