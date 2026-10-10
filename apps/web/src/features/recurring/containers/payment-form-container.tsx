'use client';

import { todayInTimeZone, type CategoryLanguage } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
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
  type RecurringReferenceData,
} from '../reference-data';

type ScreenState =
  RecurringLoadState | { kind: 'ready'; data: RecurringReferenceData; today: string };

/** The new recurring payment screen. Online only: nothing is kept on the device. */
export function PaymentFormContainer() {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('recurring');
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<RecurringFormErrors>({});

  useEffect(() => {
    let active = true;
    void Promise.all([loadReferenceData(api), api.getProfile()]).then(([reference, profile]) => {
      if (!active) return;
      if (reference.ok && profile.ok) {
        setState({
          kind: 'ready',
          data: reference.data,
          today: todayInTimeZone(new Date(), profile.data.preferences.timeZone),
        });
        return;
      }
      const failure = [reference, profile].find((result): result is ApiFailure => !result.ok);
      if (failure === undefined) return;
      if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setState({ kind: 'failed', error: failure.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  async function save(values: RecurringPaymentFormValues) {
    if (pending) return;
    const { request, fields } = buildRecurringPaymentRequest(values, locale);
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.createRecurringPayment(request);
    if (result.ok) {
      router.push('/recurring');
      return;
    }
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    // The form stays mounted, so what the user typed is still there for a retry.
    else setErrors({ form: failurePath(result) });
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
  if (state.data.accounts.length === 0) {
    return <EmptyState title={t('form.noAccounts')} />;
  }

  return (
    <RecurringPaymentForm
      mode="create"
      accounts={accountOptions(state.data)}
      categories={categoryOptions(state.data, language)}
      defaultStartDate={state.today}
      pending={pending}
      errors={errors}
      onSubmit={(values) => {
        void save(values);
      }}
    />
  );
}
