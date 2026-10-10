'use client';

import type { CategoryLanguage, RecurringPaymentResponse } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { formatAmount, formatMoney } from '@/lib/format-amount';
import type { Locale } from '@/i18n/routing';
import {
  RecurringLoadStateView,
  type RecurringLoadState,
} from '../components/recurring-load-state';
import {
  RecurringPaymentForm,
  type RecurringFormErrors,
} from '../components/recurring-payment-form';
import { failurePath } from '../recurring-failure';
import {
  buildRecurringPaymentRequest,
  type RecurringPaymentFormValues,
} from '../recurring-request';
import {
  accountOptions,
  categoryOptions,
  loadReferenceData,
  lookupsOf,
  type RecurringReferenceData,
} from '../reference-data';

type ScreenState =
  | RecurringLoadState
  | { kind: 'notFound' }
  | { kind: 'ready'; payment: RecurringPaymentResponse; data: RecurringReferenceData };

function text(value: number | null): string {
  return value === null ? '' : String(value);
}

/** The form values of a stored payment, with the amount written the way the user types it. */
function valuesOf(payment: RecurringPaymentResponse, locale: Locale): RecurringPaymentFormValues {
  return {
    name: payment.name,
    amount: formatAmount(BigInt(payment.amount), locale),
    accountId: payment.accountId,
    categoryId: payment.categoryId,
    frequency: payment.frequency,
    weekday: text(payment.weekday),
    dayOfMonth: text(payment.dayOfMonth),
    month: text(payment.month),
    startDate: payment.startDate,
    endDate: payment.endDate ?? '',
    mode: payment.mode,
  };
}

/** One recurring payment: its schedule, edit, pause and resume, and deletion (FR-09 to FR-11). */
export function PaymentDetailContainer({ paymentId }: { paymentId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('recurring');
  const tAll = useTranslations();
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const display: Locale = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errors, setErrors] = useState<RecurringFormErrors>({});
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.all([api.getRecurringPayment(paymentId), loadReferenceData(api)]).then(
      ([payment, reference]) => {
        if (!active) return;
        if (payment.ok && reference.ok) {
          setState({ kind: 'ready', payment: payment.data, data: reference.data });
          return;
        }
        const failure = [payment, reference].find((result): result is ApiFailure => !result.ok);
        if (failure === undefined) return;
        if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (failure.code === 'NOT_FOUND') setState({ kind: 'notFound' });
        else setState({ kind: 'failed', error: failure.messageKey });
      },
    );
    return () => {
      active = false;
    };
  }, [api, router, paymentId, attempt]);

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

  function showSaved(payment: RecurringPaymentResponse) {
    setState((current) => (current.kind === 'ready' ? { ...current, payment } : current));
  }

  async function save(values: RecurringPaymentFormValues) {
    if (pending) return;
    const { request, fields } = buildRecurringPaymentRequest(values, locale);
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.updateRecurringPayment(paymentId, request);
    setPending(false);
    if (result.ok) {
      showSaved(result.data);
      setEditing(false);
    } else if (!handleShared(result)) {
      setErrors({ form: failurePath(result) });
    }
  }

  async function togglePause(payment: RecurringPaymentResponse) {
    setPending(true);
    setNotice(undefined);
    const result =
      payment.status === 'paused'
        ? await api.resumeRecurringPayment(paymentId)
        : await api.pauseRecurringPayment(paymentId);
    setPending(false);
    if (result.ok) showSaved(result.data);
    else if (!handleShared(result)) setNotice(failurePath(result));
  }

  async function remove() {
    setPending(true);
    setNotice(undefined);
    const result = await api.deleteRecurringPayment(paymentId);
    if (result.ok) {
      router.push('/recurring');
      return;
    }
    setPending(false);
    setConfirmingDelete(false);
    // The payment stays: nothing was removed.
    if (!handleShared(result)) setNotice(failurePath(result));
  }

  const backLink = (
    <Link href="/recurring" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
      {t('back')}
    </Link>
  );

  if (state.kind === 'notFound') {
    return <EmptyState title={t('notFound')} action={backLink} />;
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

  const { payment, data } = state;
  if (editing) {
    return (
      <RecurringPaymentForm
        mode="edit"
        initial={valuesOf(payment, display)}
        accounts={accountOptions(data)}
        categories={categoryOptions(data, language)}
        defaultStartDate={payment.startDate}
        pending={pending}
        errors={errors}
        onSubmit={(values) => {
          void save(values);
        }}
        onCancel={() => {
          setEditing(false);
          setErrors({});
        }}
      />
    );
  }

  const lookups = lookupsOf(data, language);
  const currency = lookups.accounts[payment.accountId]?.currency;
  const amount =
    currency === undefined
      ? formatAmount(BigInt(payment.amount), display)
      : formatMoney(BigInt(payment.amount), currency, display);
  const day = payment.dayOfMonth === null ? '' : String(payment.dayOfMonth);
  const schedule =
    payment.frequency === 'weekly' && payment.weekday !== null
      ? t(`weekday.${payment.weekday}`)
      : payment.frequency === 'yearly' && payment.month !== null
        ? t('detail.yearlyValue', { month: t(`month.${payment.month}`), day })
        : t('detail.dayOfMonthValue', { day });
  const paused = payment.status === 'paused';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle as="h1">{payment.name}</CardTitle>
          <Badge variant={paused ? 'default' : 'success'}>{t(`status.${payment.status}`)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {notice ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{tAll(notice)}</AlertDescription>
          </Alert>
        ) : null}
        <dl className="grid gap-2 text-small">
          <Row label={t('fields.amount')} value={amount} />
          <Row
            label={t('fields.account')}
            value={lookups.accounts[payment.accountId]?.name ?? t('list.unknownAccount')}
          />
          <Row
            label={t('fields.category')}
            value={lookups.categories[payment.categoryId] ?? t('list.unknownCategory')}
          />
          <Row
            label={t('frequency.label')}
            value={`${t(`frequency.${payment.frequency}`)} · ${schedule}`}
          />
          <Row label={t('mode.label')} value={t(`mode.${payment.mode}`)} />
          <Row
            label={t('fields.startDate')}
            value={formatCalendarDate(payment.startDate, display)}
          />
          <Row
            label={t('fields.endDate')}
            value={
              payment.endDate === null
                ? t('detail.noEnd')
                : formatCalendarDate(payment.endDate, display)
            }
          />
          <Row
            label={t('detail.nextDue')}
            value={
              payment.nextDueDate === null
                ? t('list.noNextDue')
                : formatCalendarDate(payment.nextDueDate, display)
            }
          />
        </dl>
        {paused ? <p className="text-small text-muted-foreground">{t('pauseHint')}</p> : null}
        {confirmingDelete ? (
          <div
            role="alertdialog"
            aria-label={t('deleteConfirm.title')}
            className="grid gap-3 rounded-card border border-destructive p-4"
          >
            <p className="font-medium">{t('deleteConfirm.title')}</p>
            <p className="text-small text-muted-foreground">{t('deleteConfirm.description')}</p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  void remove();
                }}
              >
                {t('deleteConfirm.confirm')}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                {t('deleteConfirm.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setErrors({});
                setEditing(true);
              }}
            >
              {t('actions.edit')}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                void togglePause(payment);
              }}
            >
              {paused ? t('actions.resume') : t('actions.pause')}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              {t('actions.delete')}
            </Button>
            {backLink}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
