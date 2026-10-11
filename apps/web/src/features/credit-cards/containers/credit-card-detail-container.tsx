'use client';

import type {
  AccountResponse,
  CreditCardResponse,
  InstallmentPurchaseResponse,
  StatementResponse,
} from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { loadAll } from '@/features/movements/use-movement-form-data';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import {
  CardDaysForm,
  type CardDaysMessage,
  type CardDaysValues,
} from '../components/card-days-form';
import {
  CreditCardsLoadStateView,
  type CreditCardsLoadState,
} from '../components/credit-cards-load-state';
import { CardSummary } from '../components/card-summary';
import { DebitAccountsForm } from '../components/debit-accounts-form';
import { InstallmentPurchaseList } from '../components/installment-purchase-list';
import type { StatementDatesValues } from '../components/statement-dates-form';
import { StatementList } from '../components/statement-list';
import { parseDay } from '../credit-card-form-errors';
import { buildDebitAccountsRequest, debitCandidates } from '../debit-accounts-request';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;

type PageState =
  | CreditCardsLoadState
  | { kind: 'notFound' }
  | {
      kind: 'ready';
      card: CreditCardResponse;
      statements: StatementResponse[];
      purchases: InstallmentPurchaseResponse[];
      accounts: AccountResponse[];
      pendingDebt: { ARS: string; USD: string };
    };

/** A full catalog path: API errors live in `errors`, the card page ones in `creditCards.detail`. */
type Notice = `errors.${ApiFailure['messageKey']}` | 'creditCards.detail.datesInvalid';

/** The card page: default days, statements and deletion (FR-05 to FR-08). */
export function CreditCardDetailContainer({ cardId }: { cardId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations();
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [request, setRequest] = useState(0);
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [daysErrors, setDaysErrors] = useState<
    Partial<Record<keyof CardDaysValues, CardDaysMessage>>
  >({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingPurchaseId, setConfirmingPurchaseId] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  const [debitError, setDebitError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getCreditCard(cardId),
      api.listStatements(cardId),
      api.listInstallmentPurchases(cardId),
      loadAll((offset) =>
        api.listAccounts({ archived: false, limit: PAGE_SIZE, ...(offset > 0 ? { offset } : {}) }),
      ),
    ]).then(([card, statements, purchases, accounts]) => {
      if (!active) return;
      if (card.ok && statements.ok && purchases.ok && accounts.ok) {
        setState({
          kind: 'ready',
          card: card.data,
          statements: statements.data.items,
          purchases: purchases.data.items,
          accounts: accounts.data,
          pendingDebt: purchases.data.pendingDebt,
        });
        return;
      }
      const failure = [card, statements, purchases, accounts].find(
        (result): result is ApiFailure => !result.ok,
      );
      if (failure === undefined) return;
      if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else if (failure.code === 'NOT_FOUND') setState({ kind: 'notFound' });
      else setState({ kind: 'failed', error: failure.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, cardId, request]);

  /** `true` when the failure was handled here. */
  function handleShared(failure: ApiFailure): boolean {
    if (failure.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
      return true;
    }
    if (failure.code === 'NOT_FOUND') {
      setState({ kind: 'notFound' });
      return true;
    }
    return false;
  }

  async function reloadStatements() {
    const result = await api.listStatements(cardId);
    if (result.ok) {
      setState((current) =>
        current.kind === 'ready' ? { ...current, statements: result.data.items } : current,
      );
    }
  }

  async function reloadPurchases() {
    const [statements, purchases] = await Promise.all([
      api.listStatements(cardId),
      api.listInstallmentPurchases(cardId),
    ]);
    if (statements.ok && purchases.ok) {
      setState((current) =>
        current.kind === 'ready'
          ? {
              ...current,
              statements: statements.data.items,
              purchases: purchases.data.items,
              pendingDebt: purchases.data.pendingDebt,
            }
          : current,
      );
    }
  }

  async function removePurchase(id: string) {
    setPending(true);
    setNotice(undefined);
    const result = await api.deleteInstallmentPurchase(cardId, id);
    setPending(false);
    setConfirmingPurchaseId(undefined);
    if (result.ok) {
      await reloadPurchases();
    } else if (!handleShared(result)) {
      // The purchase stays listed: nothing was removed.
      setNotice(`errors.${result.messageKey}`);
    }
  }

  async function saveStatement(id: string, values: StatementDatesValues) {
    setPending(true);
    setNotice(undefined);
    const result = await api.updateStatement(cardId, id, values);
    setPending(false);
    if (result.ok) {
      const saved = result.data;
      setEditingId(undefined);
      setState((current) =>
        current.kind === 'ready'
          ? {
              ...current,
              statements: current.statements.map((s) => (s.id === saved.id ? saved : s)),
            }
          : current,
      );
    } else if (handleShared(result)) {
      return;
    } else if (result.code === 'VALIDATION_FAILED') {
      setNotice('creditCards.detail.datesInvalid');
    } else {
      // A statement that closed while the form was open: say so and show the current state.
      setNotice(`errors.${result.messageKey}`);
      if (result.code === 'STATEMENT_CLOSED') {
        setEditingId(undefined);
        await reloadStatements();
      }
    }
  }

  async function saveDays(values: CardDaysValues) {
    const closingDay = parseDay(values.closingDay);
    const dueDay = parseDay(values.dueDay);
    if (closingDay === null || dueDay === null) {
      setDaysErrors({
        ...(closingDay === null ? { closingDay: 'creditCards.errors.dayInvalid' } : {}),
        ...(dueDay === null ? { dueDay: 'creditCards.errors.dayInvalid' } : {}),
      });
      return;
    }
    setPending(true);
    setDaysErrors({});
    setNotice(undefined);
    const result = await api.updateCreditCardDays(cardId, { closingDay, dueDay });
    setPending(false);
    if (result.ok) {
      const card = result.data;
      setState((current) => (current.kind === 'ready' ? { ...current, card } : current));
      await reloadStatements();
    } else if (handleShared(result)) {
      return;
    } else if (result.code === 'VALIDATION_FAILED') {
      setDaysErrors({ closingDay: 'creditCards.detail.daysConflict' });
    } else {
      setNotice(`errors.${result.messageKey}`);
    }
  }

  async function saveDebitAccounts(values: { ars: string; usd: string }) {
    setPending(true);
    setDebitError(undefined);
    const result = await api.setCardDebitAccounts(cardId, buildDebitAccountsRequest(values));
    setPending(false);
    if (result.ok) {
      const card = result.data;
      setState((current) => (current.kind === 'ready' ? { ...current, card } : current));
    } else if (!handleShared(result)) {
      // The form stays mounted, so the selection is still the one the user made.
      setDebitError(
        result.code === 'NETWORK'
          ? 'creditCards.detail.debitConnectionNeeded'
          : `errors.${result.messageKey}`,
      );
    }
  }

  async function remove() {
    setPending(true);
    setNotice(undefined);
    const result = await api.deleteCreditCard(cardId);
    setPending(false);
    setConfirmingDelete(false);
    if (result.ok) {
      router.push('/cards');
    } else if (!handleShared(result)) {
      setNotice(`errors.${result.messageKey}`);
    }
  }

  const back = (
    <Link href="/cards" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
      {t('creditCards.detail.back')}
    </Link>
  );

  if (state.kind === 'notFound') {
    return <EmptyState title={t('creditCards.detail.notFound')} action={back} />;
  }
  if (state.kind !== 'ready') {
    return (
      <CreditCardsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setRequest((current) => current + 1);
        }}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title">{state.card.name}</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/cards/${cardId}/payments/new`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('creditCards.detail.payStatement')}
          </Link>
          <Link
            href={`/cards/${cardId}/installments/new`}
            className={buttonVariants({ variant: 'default', size: 'sm' })}
          >
            {t('creditCards.detail.addPurchase')}
          </Link>
          <Link
            href={`/cards/${cardId}/import`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('creditCards.detail.importStatement')}
          </Link>
          {back}
        </div>
      </div>
      {notice ? (
        <Alert variant="destructive">
          <AlertDescription>{t(notice)}</AlertDescription>
        </Alert>
      ) : null}
      <CardSummary
        cardName={state.card.name}
        statements={state.statements}
        pendingDebt={state.pendingDebt}
      />
      <CardDaysForm
        key={`${String(state.card.closingDay)}-${String(state.card.dueDay)}`}
        card={state.card}
        pending={pending}
        errors={daysErrors}
        onSave={(values) => {
          void saveDays(values);
        }}
      />
      <DebitAccountsForm
        key={`${state.card.debitArsAccountId ?? ''}-${state.card.debitUsdAccountId ?? ''}`}
        saved={state.card}
        arsOptions={debitOptions(state.accounts, 'ARS', state.card)}
        usdOptions={debitOptions(state.accounts, 'USD', state.card)}
        pending={pending}
        error={debitError}
        onSave={(values) => {
          void saveDebitAccounts(values);
        }}
      />
      <section className="grid gap-3">
        <h2 className="text-heading">{t('creditCards.detail.statements')}</h2>
        <StatementList
          statements={state.statements}
          editingId={editingId}
          pending={pending}
          onEdit={(id) => {
            setNotice(undefined);
            setEditingId(id);
          }}
          onCancel={() => {
            setEditingId(undefined);
          }}
          onSave={(id, values) => {
            void saveStatement(id, values);
          }}
        />
      </section>
      <section className="grid gap-3">
        <h2 className="text-heading">{t('creditCards.installments.heading')}</h2>
        <InstallmentPurchaseList
          purchases={state.purchases}
          pendingDebt={state.pendingDebt}
          confirmingId={confirmingPurchaseId}
          pending={pending}
          onAskDelete={setConfirmingPurchaseId}
          onCancelDelete={() => {
            setConfirmingPurchaseId(undefined);
          }}
          onDelete={(id) => {
            void removePurchase(id);
          }}
        />
      </section>
      <section className="grid gap-3">
        {confirmingDelete ? (
          <div className="grid gap-3 rounded-card border border-destructive/40 p-4">
            <p>{t('creditCards.detail.confirmDelete', { name: state.card.name })}</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void remove();
                }}
              >
                {t('creditCards.detail.confirm')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                {t('creditCards.detail.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNotice(undefined);
                setConfirmingDelete(true);
              }}
            >
              {t('creditCards.detail.delete')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function debitOptions(
  accounts: AccountResponse[],
  currency: 'ARS' | 'USD',
  card: CreditCardResponse,
) {
  return debitCandidates(accounts, currency, card).map((account) => ({
    id: account.id,
    label: account.name,
  }));
}
