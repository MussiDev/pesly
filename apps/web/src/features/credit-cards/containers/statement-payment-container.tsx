'use client';

import { instantToZonedLocal, type AccountResponse, type CreditCardResponse } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { loadAll } from '@/features/movements/use-movement-form-data';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import {
  CreditCardsLoadStateView,
  type CreditCardsLoadState,
} from '../components/credit-cards-load-state';
import {
  StatementPaymentForm,
  type StatementPaymentAlertMessage,
  type StatementPaymentFormErrors,
} from '../components/statement-payment-form';
import {
  buildStatementPaymentRequest,
  type StatementPaymentFormValues,
} from '../statement-payment-request';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;

type PageState =
  | CreditCardsLoadState
  | { kind: 'notFound' }
  | {
      kind: 'ready';
      card: CreditCardResponse;
      accounts: AccountResponse[];
      timeZone: string;
      defaultOccurredAt: string;
    };

/** Where a failed save is shown: one alert above the form, the typed values stay where they are. */
function failureAlert(failure: ApiFailure): StatementPaymentAlertMessage {
  if (failure.code === 'NETWORK') return { path: 'creditCards.payments.connectionNeeded' };
  if (failure.code === 'RATE_LIMITED') {
    return failure.retryAfterSeconds === undefined
      ? { path: 'movements.errors.rateLimitedGeneric' }
      : { path: 'movements.errors.rateLimited', seconds: failure.retryAfterSeconds };
  }
  return { path: `errors.${failure.messageKey satisfies ErrorMessageKey}` };
}

/**
 * The statement payment screen (10d FR-01). Online only: there is no device copy to fall back to,
 * so a missing connection is reported on the form and what was typed is kept.
 */
export function StatementPaymentContainer({ cardId }: { cardId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('creditCards');
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<StatementPaymentFormErrors>({});

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getCreditCard(cardId),
      loadAll((offset) =>
        api.listAccounts({ archived: false, limit: PAGE_SIZE, ...(offset > 0 ? { offset } : {}) }),
      ),
      api.getProfile(),
    ]).then(([card, accounts, profile]) => {
      if (!active) return;
      if (card.ok && accounts.ok && profile.ok) {
        const { timeZone } = profile.data.preferences;
        setState({
          kind: 'ready',
          card: card.data,
          accounts: accounts.data,
          timeZone,
          defaultOccurredAt: instantToZonedLocal(new Date(), timeZone),
        });
        return;
      }
      const failure = [card, accounts, profile].find((result): result is ApiFailure => !result.ok);
      if (failure === undefined) return;
      if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else if (failure.code === 'NOT_FOUND') setState({ kind: 'notFound' });
      else setState({ kind: 'failed', error: failure.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, cardId, attempt]);

  /** The caller's open accounts, without the two linked accounts of this card. */
  function sources(ready: PageState & { kind: 'ready' }): AccountResponse[] {
    const own = [ready.card.arsAccountId, ready.card.usdAccountId];
    return ready.accounts.filter((account) => !account.archived && !own.includes(account.id));
  }

  async function save(values: StatementPaymentFormValues, ready: PageState & { kind: 'ready' }) {
    if (pending) return;
    const { request, fields } = buildStatementPaymentRequest(values, {
      accounts: sources(ready),
      timeZone: ready.timeZone,
      locale,
      now: new Date(),
    });
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.recordStatementPayment(cardId, request);
    setPending(false);
    if (result.ok) {
      router.push(`/cards/${cardId}`);
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else if (result.code === 'NOT_FOUND') {
      setState({ kind: 'notFound' });
    } else {
      // The form stays mounted, so what the user typed is still there for a retry.
      setErrors({ form: failureAlert(result) });
    }
  }

  if (state.kind === 'notFound') {
    return (
      <EmptyState
        title={t('payments.notFound')}
        action={
          <Link href="/cards" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('detail.back')}
          </Link>
        }
      />
    );
  }
  if (state.kind !== 'ready') {
    return (
      <CreditCardsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const ready = state;
  return (
    <StatementPaymentForm
      cardId={cardId}
      accounts={sources(ready).map((account) => ({
        id: account.id,
        label: account.name,
        currency: account.currency,
      }))}
      defaultOccurredAt={ready.defaultOccurredAt}
      pending={pending}
      errors={errors}
      onSubmit={(values) => {
        void save(values, ready);
      }}
    />
  );
}
