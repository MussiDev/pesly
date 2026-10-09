'use client';

import type {
  CategoryLanguage,
  ListRecurringPaymentsResponse,
  UpcomingItem,
  UpcomingResponse,
} from '@pesly/shared';
import { Repeat } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import type { ConfirmFormErrors } from '../components/confirm-occurrence-form';
import type { RecurringLookups } from '../components/recurring-lookups';
import {
  RecurringLoadStateView,
  type RecurringLoadState,
} from '../components/recurring-load-state';
import { RecurringPaymentList } from '../components/recurring-payment-list';
import { UpcomingList } from '../components/upcoming-list';
import { failurePath } from '../recurring-failure';
import { buildConfirmRequest, type ConfirmFormValues } from '../recurring-request';
import { loadReferenceData, lookupsOf } from '../reference-data';

type ScreenState =
  | RecurringLoadState
  | {
      kind: 'ready';
      upcoming: UpcomingResponse['items'];
      payments: ListRecurringPaymentsResponse['items'];
      lookups: RecurringLookups;
    };

/** The recurring payments screen: what is due, with confirm and skip, and all the payments. */
export function UpcomingContainer() {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('recurring');
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [confirmingId, setConfirmingId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [confirmErrors, setConfirmErrors] = useState<ConfirmFormErrors>({});
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getUpcomingRecurring(),
      api.listRecurringPayments(),
      loadReferenceData(api),
    ]).then(([upcoming, payments, reference]) => {
      if (!active) return;
      if (upcoming.ok && payments.ok && reference.ok) {
        setState({
          kind: 'ready',
          upcoming: upcoming.data.items,
          payments: payments.data.items,
          lookups: lookupsOf(reference.data, language),
        });
        return;
      }
      const failure = [upcoming, payments, reference].find(
        (result): result is ApiFailure => !result.ok,
      );
      if (failure === undefined) return;
      if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setState({ kind: 'failed', error: failure.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, language, attempt]);

  /** Re-reads the two lists after a change; what is shown stays if the read fails. */
  async function refresh() {
    const [upcoming, payments] = await Promise.all([
      api.getUpcomingRecurring(),
      api.listRecurringPayments(),
    ]);
    if (upcoming.ok && payments.ok) {
      setState((current) =>
        current.kind === 'ready'
          ? { ...current, upcoming: upcoming.data.items, payments: payments.data.items }
          : current,
      );
    }
  }

  /** `true` when the failure was handled here; the rest is shown where the action happened. */
  async function handleShared(failure: ApiFailure): Promise<boolean> {
    if (failure.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
      return true;
    }
    if (failure.code === 'RECURRING_OCCURRENCE_NOT_PENDING') {
      // Someone resolved it first (another tab or device): show why and bring the list up to date.
      setConfirmingId(undefined);
      setConfirmErrors({});
      setNotice(failurePath(failure));
      await refresh();
      return true;
    }
    return false;
  }

  async function confirm(item: UpcomingItem, values: ConfirmFormValues) {
    if (item.occurrenceId === null || pending) return;
    const { request, fields } = buildConfirmRequest(values, locale);
    if (request === undefined) {
      setConfirmErrors({ fields });
      return;
    }
    setPending(true);
    setConfirmErrors({});
    setNotice(undefined);
    const result = await api.confirmOccurrence(item.occurrenceId, request);
    setPending(false);
    if (result.ok) {
      setConfirmingId(undefined);
      await refresh();
    } else if (!(await handleShared(result))) {
      // The form stays mounted, so what the user typed is still there for a retry.
      setConfirmErrors({ form: failurePath(result) });
    }
  }

  async function skip(item: UpcomingItem) {
    if (item.occurrenceId === null || pending) return;
    setPending(true);
    setNotice(undefined);
    setConfirmingId(undefined);
    const result = await api.skipOccurrence(item.occurrenceId);
    setPending(false);
    if (result.ok) await refresh();
    else if (!(await handleShared(result))) setNotice(failurePath(result));
  }

  if (state.kind !== 'ready') {
    return (
      <RecurringLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const newPayment = (
    <Link href="/recurring/new" className={buttonVariants({ size: 'sm' })}>
      {t('list.newPayment')}
    </Link>
  );

  if (state.upcoming.length === 0 && state.payments.length === 0) {
    return (
      <EmptyState
        icon={<Repeat aria-hidden="true" />}
        title={t('list.emptyTitle')}
        description={t('list.empty')}
        action={newPayment}
      />
    );
  }

  const { lookups } = state;
  return (
    <div className="grid gap-6">
      <div className="flex justify-end">{newPayment}</div>
      <h2 className="text-heading">{t('nav.upcoming')}</h2>
      <UpcomingList
        items={state.upcoming}
        lookups={lookups}
        confirmingId={confirmingId}
        pending={pending}
        confirmErrors={confirmErrors}
        notice={notice}
        onConfirmOpen={(item) => {
          setNotice(undefined);
          setConfirmErrors({});
          setConfirmingId(item.occurrenceId ?? undefined);
        }}
        onConfirmCancel={() => {
          setConfirmingId(undefined);
          setConfirmErrors({});
        }}
        onConfirmSubmit={(item, values) => {
          void confirm(item, values);
        }}
        onSkip={(item) => {
          void skip(item);
        }}
      />
      {state.payments.length === 0 ? null : (
        <section className="grid gap-3">
          <h2 className="text-heading">{t('nav.all')}</h2>
          <RecurringPaymentList payments={state.payments} lookups={lookups} />
        </section>
      )}
    </div>
  );
}
