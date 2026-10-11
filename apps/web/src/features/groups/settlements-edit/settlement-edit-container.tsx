'use client';

import type { GroupDetailResponse, SettlementResponse } from '@pesly/shared';
import { Clock, Lock, Users } from 'lucide-react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Link, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import type { QueuedGroupChange } from '@/lib/local-store/group-queue';
import { GroupNotFoundView } from '../components/group-not-found';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';
import { GroupConflictContainer } from '../containers/group-conflict-container';
import { DeleteConfirm } from '../edit/components/delete-confirm';
import { FailedChangePanel } from '../edit/components/failed-change-panel';
import { canEditRecord, isConsolidatedSettlement, selfRole } from '../edit/permissions';
import {
  buildSettlementEditRequest,
  settlementEditValues,
  type SettlementEditFieldErrors,
  type SettlementEditValues,
} from '../edit/settlement-edit-request';
import { useGroupChanges } from '../edit/use-group-changes';
import { isGroupId } from '../group-id';
import { SettlementDeleteOnly } from './settlement-delete-only';
import { SettlementEditForm } from './settlement-edit-form';

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | { kind: 'record-not-found' }
  | { kind: 'ready'; group: GroupDetailResponse; settlement: SettlementResponse };

interface SettlementEditContainerProps {
  groupId: string;
  settlementId: string;
}

function RecordNotFoundView({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.edit.settlement');
  return (
    <EmptyState
      icon={<Users aria-hidden="true" />}
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        isGroupId(groupId) ? (
          <Link href={`/groups/${groupId}/settlements`} className={buttonVariants()}>
            {t('back')}
          </Link>
        ) : null
      }
    />
  );
}

/**
 * Edits or deletes one settlement. Nothing is sent from here: an edit or a delete goes to the
 * device queue and the sync pass sends it (D2). The screen makes two requests on load (D4).
 */
export function SettlementEditContainer({ groupId, settlementId }: SettlementEditContainerProps) {
  if (!isGroupId(groupId)) return <GroupNotFoundView />;
  if (!isGroupId(settlementId)) return <RecordNotFoundView groupId={groupId} />;
  return <LoadedSettlementEdit groupId={groupId} settlementId={settlementId} />;
}

function LoadedSettlementEdit({ groupId, settlementId }: SettlementEditContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([api.getGroup(groupId), api.getSettlement(groupId, settlementId)]).then(
      ([group, record]) => {
        if (!active) return;
        if (
          (!group.ok && group.code === 'UNAUTHENTICATED') ||
          (!record.ok && record.code === 'UNAUTHENTICATED')
        ) {
          router.replace('/sign-in');
        } else if (!group.ok) {
          setState(
            group.code === 'NOT_FOUND'
              ? { kind: 'not-found' }
              : { kind: 'failed', error: group.messageKey },
          );
        } else if (!record.ok) {
          setState(
            record.code === 'NOT_FOUND'
              ? { kind: 'record-not-found' }
              : { kind: 'failed', error: record.messageKey },
          );
        } else {
          setState({ kind: 'ready', group: group.data, settlement: record.data });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, groupId, settlementId, router, attempt]);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  if (state.kind === 'not-found') return <GroupNotFoundView />;
  if (state.kind === 'record-not-found') return <RecordNotFoundView groupId={groupId} />;
  if (state.kind !== 'ready') {
    return (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          reload();
        }}
      />
    );
  }
  return (
    <SettlementEditScreen
      groupId={groupId}
      group={state.group}
      settlement={state.settlement}
      onReload={reload}
    />
  );
}

interface ScreenProps {
  groupId: string;
  group: GroupDetailResponse;
  settlement: SettlementResponse;
  onReload: () => void;
}

function SettlementEditScreen({ groupId, group, settlement, onReload }: ScreenProps) {
  const t = useTranslations('groups.edit.settlement');
  const tDetail = useTranslations('groups.detail');
  const changes = useGroupChanges(groupId);
  const listHref = `/groups/${groupId}/settlements`;

  const role = selfRole(group.members, group.selfMemberId);
  const back = (
    <Link href={listHref} className={buttonVariants({ variant: 'outline' })}>
      {t('back')}
    </Link>
  );
  const header = <PageHeader title={t('title')} description={group.name} actions={back} />;

  if (!canEditRecord(settlement.createdByMemberId, group.selfMemberId, role)) {
    return (
      <EmptyState
        icon={<Lock aria-hidden="true" />}
        title={t('notAllowed.title')}
        description={t('notAllowed.description')}
        action={back}
      />
    );
  }
  if (!changes.ready) return <GroupsLoadStateView state={{ kind: 'loading' }} onRetry={onReload} />;

  const change = changes.changes.find(
    (item) => item.kind === 'settlement' && item.id === settlement.id,
  );
  const names: Record<string, string> = {};
  for (const member of [...group.members, ...group.formerMembers]) {
    names[member.id] = member.displayName ?? tDetail('unnamed');
  }

  if (change?.conflict !== undefined) {
    return (
      <div className="grid gap-6">
        {header}
        <GroupConflictContainer
          kind="settlement"
          id={settlement.id}
          memberNames={names}
          onResolved={onReload}
        />
      </div>
    );
  }

  const panel =
    change?.rejection === undefined ? null : (
      <FailedChangePanel
        code={change.rejection.code}
        onRetry={() => {
          void changes.retry('settlement', settlement.id);
        }}
        onDiscard={() => {
          void changes.discard('settlement', settlement.id);
        }}
      />
    );

  if (change?.operation === 'delete') {
    return (
      <div className="grid gap-6">
        {header}
        {panel}
        <EmptyState
          icon={<Clock aria-hidden="true" />}
          title={t('deleting.title')}
          description={t('deleting.description')}
          action={back}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {header}
      {panel}
      <SettlementEditBody
        groupId={groupId}
        group={group}
        settlement={settlement}
        change={change}
        names={names}
        available={changes.available}
        queueUpdate={changes.queueUpdate}
        queueDelete={changes.queueDelete}
      />
    </div>
  );
}

interface BodyProps {
  groupId: string;
  group: GroupDetailResponse;
  settlement: SettlementResponse;
  change: QueuedGroupChange | undefined;
  names: Record<string, string>;
  available: boolean;
  queueUpdate: ReturnType<typeof useGroupChanges>['queueUpdate'];
  queueDelete: ReturnType<typeof useGroupChanges>['queueDelete'];
}

function SettlementEditBody({
  groupId,
  settlement,
  change,
  names,
  available,
  queueUpdate,
  queueDelete,
}: BodyProps): ReactNode {
  const router = useRouter();
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const tDetail = useTranslations('groups.detail');
  const listHref = `/groups/${groupId}/settlements`;

  const [values, setValues] = useState<SettlementEditValues>(() =>
    settlementEditValues(
      settlement,
      change?.kind === 'settlement' && change.operation === 'update' ? change.request : undefined,
      { locale, timeZone },
    ),
  );
  const [errors, setErrors] = useState<SettlementEditFieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // A ref, not state: a second click in the same tick must see the first one.
  const locked = useRef(false);

  async function save() {
    if (locked.current) return;
    const result = buildSettlementEditRequest(values, settlement, {
      timeZone,
      locale,
      now: new Date(),
    });
    if (result.request === undefined) {
      setErrors(result.fields);
      return;
    }
    setErrors({});
    setFailed(false);
    locked.current = true;
    setPending(true);
    const stored = await queueUpdate({
      kind: 'settlement',
      base: settlement,
      request: result.request,
    });
    if (stored) {
      // Stays locked: the screen is about to close and must not queue twice.
      router.push(listHref);
      return;
    }
    locked.current = false;
    setPending(false);
    setFailed(true);
  }

  async function remove() {
    if (locked.current) return;
    setFailed(false);
    locked.current = true;
    setPending(true);
    const stored = await queueDelete({ kind: 'settlement', base: settlement });
    if (stored) {
      router.push(listHref);
      return;
    }
    locked.current = false;
    setPending(false);
    setFailed(true);
  }

  const unavailable = !available || failed;

  if (isConsolidatedSettlement(settlement)) {
    return (
      <SettlementDeleteOnly
        confirming={confirming}
        pending={pending}
        unavailable={unavailable}
        onAskDelete={() => {
          setConfirming(true);
        }}
        onConfirm={() => {
          void remove();
        }}
        onCancel={() => {
          setConfirming(false);
        }}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <SettlementEditForm
        values={values}
        errors={errors}
        payer={names[settlement.fromMemberId] ?? tDetail('unnamed')}
        payee={names[settlement.toMemberId] ?? tDetail('unnamed')}
        currency={settlement.currency}
        hasAccount={settlement.accountId !== null}
        pending={pending}
        unavailable={unavailable}
        onChange={(name, value) => {
          setValues((current) => ({ ...current, [name]: value }));
        }}
        onSubmit={() => {
          void save();
        }}
        onCancel={() => {
          router.push(listHref);
        }}
        onDelete={() => {
          setConfirming(true);
        }}
      />
      {confirming ? (
        <DeleteConfirm
          pending={pending}
          onConfirm={() => {
            void remove();
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </div>
  );
}
