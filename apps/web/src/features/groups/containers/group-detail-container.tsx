'use client';

import { rateTypeSchema, type GroupDetailResponse } from '@pesly/shared';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Link, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import type { ApiFailure, ApiResult } from '@/lib/api-client';
import { GroupAdminActions } from '../components/group-admin-actions';
import { OwnBalanceSummary, type OwnBalanceLine } from '../components/own-balance-summary';
import { GroupMembers } from '../components/group-members';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';
import { LeaveGroupPanel } from '../components/leave-group-panel';
import { buildBalanceView } from '../settlements/balance-view';
import { GroupGhostContainer } from './group-ghost-container';
import { GroupInviteContainer } from './group-invite-container';

type ScreenState =
  GroupsLoadState | { kind: 'not-found' } | { kind: 'ready'; group: GroupDetailResponse };

/** What a panel mounted into the detail page (Block 4) needs from it. */
export interface GroupPanelsContext {
  group: GroupDetailResponse;
  isAdmin: boolean;
  /** Loads the group again, quietly, e.g. after a ghost member was added. */
  reload: () => void;
}

interface GroupDetailContainerProps {
  groupId: string;
  /**
   * Mount point for the invitation and ghost-member panels: rendered inside the
   * `data-slot="group-panels"` region of the page.
   */
  panels?: (context: GroupPanelsContext) => ReactNode;
}

/** One group: members, admin actions, links and leaving. Online only: nothing is kept offline. */
export function GroupDetailContainer({ groupId, panels }: GroupDetailContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.detail');
  const tRate = useTranslations('profile.rateTypes');
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [memberIssue, setMemberIssue] = useState<{
    memberId: string;
    failure: ApiFailure;
    selfRemoval?: boolean;
  }>();
  const [rateIssue, setRateIssue] = useState<ApiFailure>();
  const [rateSaved, setRateSaved] = useState(false);
  const [leaveIssue, setLeaveIssue] = useState<ApiFailure>();
  /** Undefined while loading, null when the balances could not be loaded (secondary information). */
  const [ownBalance, setOwnBalance] = useState<OwnBalanceLine[] | null | undefined>();

  useEffect(() => {
    let active = true;
    setOwnBalance(undefined);
    void Promise.all([api.getGroup(groupId), api.getGroupBalances(groupId)]).then(
      ([result, balances]) => {
        if (!active) return;
        if (result.ok) {
          setState({ kind: 'ready', group: result.data });
          setOwnBalance(
            balances.ok
              ? buildBalanceView(balances.data, result.data, result.data.selfMemberId).map(
                  (view) => ({
                    currency: view.currency,
                    balance: view.rows.find((row) => row.isSelf)?.balance ?? 0n,
                  }),
                )
              : null,
          );
        } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (result.code === 'NOT_FOUND') setState({ kind: 'not-found' });
        else setState({ kind: 'failed', error: result.messageKey });
      },
    );
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt]);

  if (state.kind === 'not-found') {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Link href="/groups" className={buttonVariants()}>
            {t('notFound.back')}
          </Link>
        }
      />
    );
  }

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

  const { group } = state;
  const isAdmin = group.role === 'admin';

  /** Runs one action; a 401 that could not be refreshed goes to sign-in. */
  async function run<T>(
    action: () => Promise<ApiResult<T>>,
    onResult: (result: ApiResult<T>) => void,
  ) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok && result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else onResult(result);
  }

  async function reload() {
    const result = await api.getGroup(groupId);
    if (result.ok) setState({ kind: 'ready', group: result.data });
  }

  function promote(memberId: string) {
    setMemberIssue(undefined);
    void run(
      () => api.promoteMember(groupId, memberId),
      (result) => {
        if (!result.ok) {
          setMemberIssue({ memberId, failure: result });
          return;
        }
        const promoted = result.data;
        setState({
          kind: 'ready',
          group: {
            ...group,
            members: group.members.map((member) => (member.id === memberId ? promoted : member)),
          },
        });
      },
    );
  }

  function remove(memberId: string) {
    setMemberIssue(undefined);
    void run(
      () => api.removeMember(groupId, memberId),
      (result) => {
        if (result.ok) void reload();
        else {
          // The caller's own member id is not in the response, so the API's refusal (CannotRemoveSelf
          // on params.memberId) is the only signal that the admin pressed Remove on their own row.
          setMemberIssue({
            memberId,
            failure: result,
            selfRemoval: result.code === 'VALIDATION_FAILED',
          });
        }
      },
    );
  }

  function changeRateType(value: string) {
    const rateType = rateTypeSchema.safeParse(value);
    if (!rateType.success) return;
    setRateIssue(undefined);
    setRateSaved(false);
    void run(
      () => api.updateGroupRateType(groupId, { defaultRateType: rateType.data }),
      (result) => {
        if (!result.ok) {
          setRateIssue(result);
          return;
        }
        setRateSaved(true);
        setState({
          kind: 'ready',
          group: { ...group, defaultRateType: result.data.defaultRateType },
        });
      },
    );
  }

  function leave() {
    setLeaveIssue(undefined);
    void run(
      () => api.leaveGroup(groupId),
      (result) => {
        if (result.ok) router.push('/groups');
        else setLeaveIssue(result);
      },
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={group.name}
        description={t('defaultRate', { rateType: tRate(group.defaultRateType) })}
        actions={
          <>
            <Link
              href={`/groups/${encodeURIComponent(group.id)}/balances`}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('balancesLink')}
            </Link>
            <Link
              href={`/groups/${encodeURIComponent(group.id)}/categories`}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('categoriesLink')}
            </Link>
          </>
        }
      />
      {ownBalance === undefined ? null : <OwnBalanceSummary lines={ownBalance} />}
      <GroupMembers
        members={group.members}
        formerMembers={group.formerMembers}
        canAdmin={isAdmin}
        busy={busy}
        issue={memberIssue}
        onPromote={promote}
        onRemove={remove}
      />
      <div data-slot="group-panels" className="grid gap-6 empty:hidden">
        <GroupInviteContainer groupId={group.id} />
        <GroupGhostContainer
          groupId={group.id}
          members={group.members}
          reload={() => void reload()}
        />
        {panels?.({ group, isAdmin, reload: () => void reload() })}
      </div>
      {isAdmin ? (
        <GroupAdminActions
          defaultRateType={group.defaultRateType}
          pending={busy}
          saved={rateSaved}
          issue={rateIssue}
          onChangeRateType={changeRateType}
        />
      ) : null}
      <LeaveGroupPanel pending={busy} issue={leaveIssue} onLeave={leave} />
    </div>
  );
}
