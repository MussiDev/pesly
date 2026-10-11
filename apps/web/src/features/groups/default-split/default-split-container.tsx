'use client';

import type { DefaultSplitResponse, ExpenseOptionsResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { GroupIssue } from '../components/group-issue';
import { GroupNotFoundView } from '../components/group-not-found';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';
import { isGroupId } from '../group-id';
import { DefaultSplitForm } from './default-split-form';
import { DefaultSplitReadonly } from './default-split-readonly';
import {
  buildDefaultSplitRequest,
  formatBasisPointsInput,
  type DefaultSplitFieldError,
  type DefaultSplitMode,
} from './default-split-request';

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | { kind: 'ready'; options: ExpenseOptionsResponse; isAdmin: boolean };

function valuesOf(defaultSplit: DefaultSplitResponse): Record<string, string> {
  if (defaultSplit.mode === 'equal') return {};
  return Object.fromEntries(
    defaultSplit.shares.map((share) => [share.memberId, formatBasisPointsInput(share.basisPoints)]),
  );
}

export interface DefaultSplitContainerProps {
  groupId: string;
}

/**
 * The default split of one group: editable by admins, read only for members (FR-11). It makes two
 * requests: the expense options and the group, whose members carry the caller's role.
 */
export function DefaultSplitContainer({ groupId }: DefaultSplitContainerProps) {
  if (!isGroupId(groupId)) return <GroupNotFoundView />;
  return <DefaultSplitScreen groupId={groupId} />;
}

function DefaultSplitScreen({ groupId }: DefaultSplitContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.defaultSplit');
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<DefaultSplitMode>('equal');
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<DefaultSplitFieldError[]>([]);
  const [difference, setDifference] = useState<bigint>();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [issue, setIssue] = useState<ApiFailure>();

  useEffect(() => {
    let active = true;
    void Promise.all([api.getExpenseOptions(groupId), api.getGroup(groupId)]).then(
      ([result, group]) => {
        if (!active) return;
        if (result.ok && group.ok) {
          const self = group.data.members.find((member) => member.id === result.data.selfMemberId);
          setMode(result.data.defaultSplit.mode);
          setValues(valuesOf(result.data.defaultSplit));
          setState({ kind: 'ready', options: result.data, isAdmin: self?.role === 'admin' });
          return;
        }
        const failure = !result.ok ? result : group.ok ? undefined : group;
        if (failure === undefined) return;
        if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else {
          setState(
            failure.code === 'NOT_FOUND'
              ? { kind: 'not-found' }
              : { kind: 'failed', error: failure.messageKey },
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt]);

  if (state.kind === 'not-found') return <GroupNotFoundView />;

  if (state.kind !== 'ready') {
    return (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { options, isAdmin } = state;
  const memberIds = options.members.map((member) => member.id);

  function edit(change: () => void) {
    change();
    setSaved(false);
    setIssue(undefined);
    setFieldErrors([]);
    setDifference(undefined);
  }

  function save() {
    setSaved(false);
    setIssue(undefined);
    const built = buildDefaultSplitRequest(mode, memberIds, values);
    setFieldErrors(built.errors ?? []);
    setDifference(built.difference);
    if (!built.request) return;
    const { request } = built;
    setPending(true);
    void api.setDefaultSplit(groupId, request).then((result) => {
      setPending(false);
      if (result.ok) {
        setState({ kind: 'ready', isAdmin, options: { ...options, defaultSplit: result.data } });
        setSaved(true);
      } else if (result.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
      } else {
        // The saved default and the typed values stay as they were.
        setIssue(result);
      }
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href={`/groups/${encodeURIComponent(groupId)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('back')}
          </Link>
        }
      />
      {issue ? <GroupIssue failure={issue} /> : null}
      {isAdmin ? (
        <DefaultSplitForm
          members={options.members.map((member) => ({ id: member.id, name: member.displayName }))}
          mode={mode}
          values={values}
          fieldErrors={fieldErrors}
          difference={difference}
          pending={pending}
          saved={saved}
          onModeChange={(next) => {
            edit(() => {
              setMode(next);
            });
          }}
          onValueChange={(memberId, value) => {
            edit(() => {
              setValues((current) => ({ ...current, [memberId]: value }));
            });
          }}
          onSubmit={save}
        />
      ) : (
        <DefaultSplitReadonly
          defaultSplit={options.defaultSplit}
          names={new Map(options.members.map((member) => [member.id, member.displayName]))}
        />
      )}
    </div>
  );
}
