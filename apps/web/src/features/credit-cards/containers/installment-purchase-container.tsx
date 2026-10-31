'use client';

import {
  dateInTimeZone,
  previewInstallmentSchedule,
  type CategoryLanguage,
  type CategoryResponse,
  type CreditCardResponse,
  type StatementResponse,
} from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { categoryLabel } from '@/features/categories/category-display';
import { loadAll } from '@/features/movements/use-movement-form-data';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import {
  CreditCardsLoadStateView,
  type CreditCardsLoadState,
} from '../components/credit-cards-load-state';
import {
  InstallmentForm,
  type InstallmentAlertMessage,
  type InstallmentDraftValues,
  type InstallmentFormErrors,
} from '../components/installment-form';
import {
  buildInstallmentPurchaseRequest,
  parseInstallmentDraft,
  type InstallmentFormValues,
} from '../installment-request';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;

type PageState =
  | CreditCardsLoadState
  | { kind: 'notFound' }
  | {
      kind: 'ready';
      card: CreditCardResponse;
      categories: CategoryResponse[];
      statements: StatementResponse[];
      timeZone: string;
      today: string;
    };

type ReadyState = PageState & { kind: 'ready' };

/** Where a failed save is shown: one alert above the form, the typed values stay where they are. */
function failureAlert(failure: ApiFailure): InstallmentAlertMessage {
  if (failure.code === 'NETWORK') return { path: 'creditCards.installments.connectionNeeded' };
  if (failure.code === 'RATE_LIMITED') {
    return failure.retryAfterSeconds === undefined
      ? { path: 'movements.errors.rateLimitedGeneric' }
      : { path: 'movements.errors.rateLimited', seconds: failure.retryAfterSeconds };
  }
  return { path: `errors.${failure.messageKey satisfies ErrorMessageKey}` };
}

/**
 * The card purchase screen (10c FR-01): one payment or installments. Online only, like the card expense: a missing
 * connection is reported on the form and what was typed is kept.
 */
export function InstallmentPurchaseContainer({ cardId }: { cardId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('creditCards');
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getCreditCard(cardId),
      loadAll((offset) =>
        api.listCategories({
          kind: 'expense',
          archived: false,
          limit: PAGE_SIZE,
          ...(offset > 0 ? { offset } : {}),
        }),
      ),
      api.getProfile(),
      api.listStatements(cardId),
    ]).then(([card, categories, profile, statements]) => {
      if (!active) return;
      if (card.ok && categories.ok && profile.ok && statements.ok) {
        const { timeZone } = profile.data.preferences;
        setState({
          kind: 'ready',
          card: card.data,
          categories: categories.data,
          statements: statements.data.items,
          timeZone,
          // Computed once at load: a screen left open past midnight keeps yesterday until reloaded.
          today: dateInTimeZone(new Date(), timeZone),
        });
        return;
      }
      const failure = [card, categories, profile, statements].find(
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
  }, [api, router, cardId, attempt]);

  if (state.kind === 'notFound') {
    return (
      <EmptyState
        title={t('installments.notFound')}
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

  return (
    <InstallmentPurchaseReady
      cardId={cardId}
      ready={state}
      onNotFound={() => {
        setState({ kind: 'notFound' });
      }}
    />
  );
}

function InstallmentPurchaseReady({
  cardId,
  ready,
  onNotFound,
}: {
  cardId: string;
  ready: ReadyState;
  onNotFound: () => void;
}) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<InstallmentFormErrors>({});
  const [draft, setDraft] = useState<InstallmentDraftValues>({
    currency: 'ARS',
    amount: '',
    installments: '',
    purchasedOn: ready.today,
  });

  // Editing only recomputes the rows from the statements loaded with the page: no request is sent.
  const schedule = useMemo(() => {
    const parsed = parseInstallmentDraft(draft, {
      timeZone: ready.timeZone,
      locale,
      now: new Date(),
    });
    const { currency, amount, count, purchasedOn } = parsed;
    if (currency === undefined || amount === undefined || count === undefined) return null;
    if (purchasedOn === undefined) return null;
    return previewInstallmentSchedule({
      total: amount,
      count,
      purchasedOn,
      today: ready.today,
      card: { closingDay: ready.card.closingDay, dueDay: ready.card.dueDay },
      statements: ready.statements,
    });
  }, [draft, locale, ready]);

  async function save(values: InstallmentFormValues) {
    if (pending) return;
    // Only open expense categories can be picked, so the request builder never sees an archived one.
    const open = ready.categories.filter((item) => item.kind === 'expense' && !item.archived);
    const { purchase, fields } = buildInstallmentPurchaseRequest(values, {
      categories: open,
      timeZone: ready.timeZone,
      locale,
      now: new Date(),
    });
    if (purchase === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    // One payment is a plain card expense (10b); two or more are an installment purchase.
    const result =
      purchase.kind === 'single'
        ? await api.createCardExpense(cardId, purchase.request)
        : await api.createInstallmentPurchase(cardId, purchase.request);
    setPending(false);
    if (result.ok) {
      router.push(`/cards/${cardId}`);
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else if (result.code === 'NOT_FOUND') {
      onNotFound();
    } else {
      // The form stays mounted, so what the user typed is still there for a retry.
      setErrors({ form: failureAlert(result) });
    }
  }

  return (
    <InstallmentForm
      cardId={cardId}
      categories={ready.categories
        .filter((item) => item.kind === 'expense' && !item.archived)
        .map((item) => ({
          id: item.id,
          label: categoryLabel(item, language),
          parentId: item.parentId,
          icon: item.icon,
          color: item.color,
        }))}
      defaultPurchasedOn={ready.today}
      pending={pending}
      errors={errors}
      schedule={schedule}
      currency={draft.currency === 'USD' ? 'USD' : 'ARS'}
      onDraftChange={setDraft}
      onSubmit={(values) => {
        void save(values);
      }}
    />
  );
}
