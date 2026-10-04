'use client';

import {
  formatMinorUnits,
  formatRateInput,
  instantToZonedLocal,
  type CategoryLanguage,
  type MovementResponse,
} from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AccountsLoadStateView } from '@/features/accounts/components/accounts-load-state';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { categoryLabel } from '@/features/categories/category-display';
import { Link, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import {
  MovementForm,
  type MovementFormInitialValues,
  type MovementFormValues,
} from '../components/movement-form';
import { impliedRatePreview, type ImpliedRatePreviewInput } from '../implied-rate-preview';
import { movementFailureErrors, type MovementFormErrors } from '../movement-form-errors';
import { buildMovementRequest } from '../movement-request';
import { useMovementFormData, type MovementFormData } from '../use-movement-form-data';
import { TagInputContainer } from './tag-input-container';

type MovementState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'notFound' }
  | { kind: 'ready'; movement: MovementResponse };

/** What the form shows before the user touches anything: the movement as it is stored. */
function initialValuesOf(
  movement: MovementResponse,
  data: MovementFormData,
  locale: string,
): MovementFormInitialValues {
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const categorized = movement.type === 'expense' || movement.type === 'income';
  return {
    type: movement.type,
    accountId: movement.accountId,
    categoryId: movement.categoryId ?? '',
    amount: formatMinorUnits(BigInt(movement.amount), language),
    occurredAt: instantToZonedLocal(new Date(movement.occurredAt), data.timeZone),
    rate:
      categorized && movement.rate !== null ? formatRateInput(BigInt(movement.rate), locale) : '',
    note: movement.note ?? '',
    ...(movement.destinationAccountId === null
      ? {}
      : { destinationAccountId: movement.destinationAccountId }),
    ...(movement.type === 'exchange' && movement.destinationAmount !== null
      ? { destinationAmount: formatMinorUnits(BigInt(movement.destinationAmount), language) }
      : {}),
    ...(categorized ? { tags: movement.tags } : {}),
  };
}

function NotFoundView() {
  const t = useTranslations('movements');
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <p role="alert">{t('edit.notFound')}</p>
        <Link href="/movements" className={buttonVariants({ variant: 'ghost' })}>
          {t('form.back')}
        </Link>
      </CardContent>
    </Card>
  );
}

/** Edits one movement of the user: the entry form filled in, type locked, saved with `PUT`. */
export function EditMovementContainer({ movementId }: { movementId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const form = useMovementFormData({ includeArchived: true });
  const [movementState, setMovementState] = useState<MovementState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<MovementFormErrors>({});

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const result = await api.getMovement(movementId);
      if (!isActive()) return;
      if (result.ok) {
        setMovementState({ kind: 'ready', movement: result.data });
      } else if (result.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
      } else if (result.code === 'NOT_FOUND' || result.code === 'VALIDATION_FAILED') {
        // A malformed id in the address is no movement of the user either.
        setMovementState({ kind: 'notFound' });
      } else {
        setMovementState({ kind: 'failed', error: result.messageKey });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, router, movementId, attempt]);

  async function save(
    values: MovementFormValues,
    data: MovementFormData,
    movement: MovementResponse,
  ) {
    if (pending) return;
    const { request, fields } = buildMovementRequest(values, {
      accounts: data.accounts,
      categories: data.categories,
      timeZone: data.timeZone,
      locale,
      now: new Date(),
      defaultRate: data.defaultRate,
      edit: {
        accountId: movement.accountId,
        ...(movement.destinationAccountId === null
          ? {}
          : { destinationAccountId: movement.destinationAccountId }),
        ...(movement.categoryId === null ? {} : { categoryId: movement.categoryId }),
      },
    });
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.updateMovement(movement.id, request);
    if (result.ok) {
      router.push('/movements');
      return;
    }
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else if (result.code === 'NOT_FOUND') setMovementState({ kind: 'notFound' });
    // Every other failure keeps the form mounted, so what the user typed stays for a retry.
    else setErrors(movementFailureErrors(result));
  }

  function retry() {
    setMovementState({ kind: 'loading' });
    setAttempt((current) => current + 1);
    form.retry();
  }

  if (movementState.kind === 'notFound') return <NotFoundView />;
  if (movementState.kind === 'failed') {
    return <AccountsLoadStateView state={movementState} onRetry={retry} />;
  }
  if (form.state.kind !== 'ready') {
    return <AccountsLoadStateView state={form.state} onRetry={retry} />;
  }
  if (movementState.kind !== 'ready') {
    return <AccountsLoadStateView state={{ kind: 'loading' }} onRetry={retry} />;
  }

  const { data } = form.state;
  const { movement } = movementState;
  return (
    <MovementForm
      mode="edit"
      initialValues={initialValuesOf(movement, data, locale)}
      accounts={data.accounts.filter(
        (item) =>
          !item.archived ||
          item.id === movement.accountId ||
          item.id === movement.destinationAccountId,
      )}
      categories={data.categories
        .filter((item) => !item.archived || item.id === movement.categoryId)
        .map((item) => ({ id: item.id, kind: item.kind, label: categoryLabel(item, language) }))}
      defaultOccurredAt={data.defaultOccurredAt}
      defaultRate={data.defaultRate}
      rateType={movement.rateType ?? undefined}
      rateAgeHours={undefined}
      pending={pending}
      errors={errors}
      previewRate={(input: ImpliedRatePreviewInput) =>
        impliedRatePreview(input, data.accounts, locale)
      }
      renderTagField={({ value, onChange, error }) => (
        <TagInputContainer value={value} onChange={onChange} error={error} />
      )}
      onSubmit={(values) => {
        void save(values, data, movement);
      }}
    />
  );
}
