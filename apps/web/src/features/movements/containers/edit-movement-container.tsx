'use client';

import {
  formatMinorUnits,
  formatRateInput,
  instantToZonedLocal,
  type CategoryLanguage,
  type MovementGroupLink,
  type MovementResponse,
} from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AccountsLoadStateView } from '@/features/accounts/components/accounts-load-state';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { categoryLabel, compareCategories } from '@/features/categories/category-display';
import { Link, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { isOffline } from '@/lib/connectivity';
import {
  readQueuedChange,
  readRecentMovementsCopy,
  writeQueuedEdit,
} from '@/lib/local-store/device-copy';
import { changeToMovement, type QueuedEditRequest } from '@/lib/local-store/queue';
import { readSessionPointer } from '@/lib/local-store/session-pointer';
import { notifyMovementQueued } from '@/lib/sync/sync-events';
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
  | { kind: 'notAvailableOffline' }
  /** `queued`: the device has a change of it the server does not; a save joins that change. */
  | {
      kind: 'ready';
      movement: MovementResponse;
      queued: boolean;
      /** The group expense the server links to this movement; copies and queued changes have none. */
      groupExpense: MovementGroupLink | null;
    };

/** The group name for the notice: `undefined` while loading, `null` when the group is not visible. */
type GroupNameState = { groupId: string; name: string | null } | undefined;

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

export function MovementNotFoundView({
  reason = 'notFound',
}: {
  reason?: 'notFound' | 'notAvailableOffline';
}) {
  const t = useTranslations('movements');
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <p role="alert">{t(`edit.${reason}`)}</p>
        <Link href="/movements" className={buttonVariants({ variant: 'ghost' })}>
          {t('form.back')}
        </Link>
      </CardContent>
    </Card>
  );
}

/** Says which group expense the movement belongs to and, when adopted, what is locked. */
function GroupLinkNotice({
  groupName,
  locked,
}: {
  groupName: string | null | undefined;
  locked: boolean;
}) {
  const t = useTranslations('movements.edit');
  return (
    <Alert>
      <AlertDescription className="grid gap-1">
        {groupName === undefined ? null : (
          <p>
            {groupName === null ? t('groupNoticeUnknown') : t('groupNotice', { group: groupName })}
          </p>
        )}
        {locked ? <p>{t('lockedFields')}</p> : null}
      </AlertDescription>
    </Alert>
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
  const [groupName, setGroupName] = useState<GroupNameState>(undefined);
  const linkedGroupId =
    movementState.kind === 'ready' ? movementState.groupExpense?.groupId : undefined;

  // One read of the group for the notice; a group the person cannot see is the neutral text.
  useEffect(() => {
    if (linkedGroupId === undefined) return;
    let active = true;
    const isActive = () => active;
    void (async () => {
      const result = await api.getGroup(linkedGroupId);
      if (!isActive()) return;
      setGroupName({ groupId: linkedGroupId, name: result.ok ? result.data.name : null });
    })();
    return () => {
      active = false;
    };
  }, [api, linkedGroupId]);

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const userId = readSessionPointer()?.userId;
      // A change waiting on this device is the movement as the person last left it.
      const queued = await readQueuedChange(userId, movementId);
      if (!isActive()) return;
      if (queued !== undefined) {
        setMovementState(
          queued.operation === 'delete'
            ? { kind: 'notFound' }
            : {
                kind: 'ready',
                movement: changeToMovement(queued),
                queued: true,
                groupExpense: null,
              },
        );
        return;
      }
      const showCopy = async () => {
        const copy = await readRecentMovementsCopy(userId);
        if (!isActive()) return;
        const saved = copy?.find((item) => item.id === movementId);
        setMovementState(
          saved === undefined
            ? { kind: 'notAvailableOffline' }
            : saved.type === 'adjustment'
              ? { kind: 'notFound' }
              : { kind: 'ready', movement: saved, queued: false, groupExpense: null },
        );
      };
      if (isOffline()) {
        await showCopy();
        return;
      }
      const result = await api.getMovement(movementId);
      if (!isActive()) return;
      if (result.ok) {
        const { groupExpense, ...movement } = result.data;
        // A balance adjustment is never edited: the screen treats it as not found.
        setMovementState(
          movement.type === 'adjustment'
            ? { kind: 'notFound' }
            : { kind: 'ready', movement, queued: false, groupExpense },
        );
      } else if (result.code === 'NETWORK') {
        await showCopy();
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

  /**
   * Keeps the edit on this device until it can be sent, joined to any change already waiting.
   * `false` when it could not be stored: the form stays as typed and the person is told.
   */
  async function keepOnDevice(
    movement: MovementResponse,
    request: QueuedEditRequest,
  ): Promise<boolean> {
    const stored = await writeQueuedEdit(readSessionPointer()?.userId, movement, request);
    if (!stored) return false;
    // Online, the shell sends it right away; offline it waits for the connection.
    notifyMovementQueued();
    router.push('/movements');
    return true;
  }

  async function save(
    values: MovementFormValues,
    data: MovementFormData,
    movement: MovementResponse,
    queued: boolean,
    locked: boolean,
  ) {
    if (pending) return;
    const offline = data.offline || isOffline();
    const built = buildMovementRequest(values, {
      accounts: data.accounts,
      categories: data.categories,
      timeZone: data.timeZone,
      locale,
      now: new Date(),
      defaultRate: data.defaultRate,
      offline,
      edit: {
        accountId: movement.accountId,
        ...(movement.destinationAccountId === null
          ? {}
          : { destinationAccountId: movement.destinationAccountId }),
        ...(movement.categoryId === null ? {} : { categoryId: movement.categoryId }),
      },
    });
    const { fields } = built;
    if (built.request === undefined) {
      setErrors({ fields });
      return;
    }
    // A locked movement goes back exactly as stored: the form shows the date to the minute only.
    const request: QueuedEditRequest = locked
      ? {
          ...built.request,
          accountId: movement.accountId,
          amount: movement.amount,
          occurredAt: movement.occurredAt,
        }
      : built.request;
    setPending(true);
    setErrors({});
    // A movement with a change already waiting goes through the queue, so its changes keep order.
    if (offline || queued) {
      if (!(await keepOnDevice(movement, request))) {
        setPending(false);
        setErrors({ form: 'offlineSaveFailed' });
      }
      return;
    }
    const result = await api.updateMovement(movement.id, request);
    if (result.ok) {
      router.push('/movements');
      return;
    }
    if (result.code === 'NETWORK' && (await keepOnDevice(movement, request))) return;
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

  if (movementState.kind === 'notFound' || movementState.kind === 'notAvailableOffline') {
    return <MovementNotFoundView reason={movementState.kind} />;
  }
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
  const { movement, queued, groupExpense } = movementState;
  const locked = groupExpense?.adopted === true;
  const notice =
    groupExpense === null ? undefined : (
      <GroupLinkNotice
        // The name of another link (a previous movement) must not show under this one.
        groupName={groupName?.groupId === groupExpense.groupId ? groupName.name : undefined}
        locked={locked}
      />
    );
  return (
    <MovementForm
      mode="edit"
      lockedFields={locked}
      groupNotice={notice}
      initialValues={initialValuesOf(movement, data, locale)}
      accounts={data.accounts.filter(
        (item) =>
          !item.archived ||
          item.id === movement.accountId ||
          item.id === movement.destinationAccountId,
      )}
      categories={data.categories
        .filter((item) => !item.archived || item.id === movement.categoryId)
        .sort(compareCategories)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          label: categoryLabel(item, language),
          parentId: item.parentId,
          icon: item.icon,
          color: item.color,
        }))}
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
        void save(values, data, movement, queued, locked);
      }}
    />
  );
}
