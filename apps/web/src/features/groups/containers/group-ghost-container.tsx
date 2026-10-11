'use client';

import type { GroupMemberResponse } from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import type { ApiFailure } from '@/lib/api-client';
import { AddGhostForm } from '../components/add-ghost-form';
import { ClaimLinkPanel } from '../components/claim-link-panel';
import { buildGhostRequest, type GhostNameMessage } from '../ghost-request';
import { buildGroupLink } from '../group-link';

interface GroupGhostContainerProps {
  groupId: string;
  members: GroupMemberResponse[];
  /** Loads the group again so the new member shows in the list. */
  reload: () => void;
}

/** Adding members without an account and giving them claim links. Online only. */
export function GroupGhostContainer({ groupId, members, reload }: GroupGhostContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [nameError, setNameError] = useState<GhostNameMessage>();
  const [issue, setIssue] = useState<ApiFailure>();
  const [resetKey, setResetKey] = useState(0);
  const [claim, setClaim] = useState<{
    memberId: string;
    pending: boolean;
    link?: string;
    issue?: ApiFailure;
  }>();

  async function add(name: string) {
    if (pending) return;
    const { request, error } = buildGhostRequest(name);
    if (request === undefined) {
      setNameError(error);
      return;
    }
    setNameError(undefined);
    setIssue(undefined);
    setPending(true);
    const result = await api.addGhostMember(groupId, request);
    setPending(false);
    if (result.ok) {
      setResetKey((current) => current + 1);
      reload();
    } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setIssue(result);
  }

  async function createClaimLink(memberId: string) {
    if (claim?.pending) return;
    setClaim({ memberId, pending: true });
    const result = await api.createClaimLink(groupId, memberId);
    if (result.ok) {
      setClaim({
        memberId,
        pending: false,
        link: buildGroupLink('claim', result.data.token, window.location.origin, locale),
      });
    } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setClaim({ memberId, pending: false, issue: result });
  }

  return (
    <>
      <AddGhostForm
        pending={pending}
        nameError={nameError}
        issue={issue}
        resetKey={resetKey}
        onSubmit={(name) => {
          void add(name);
        }}
      />
      <ClaimLinkPanel
        ghosts={members.filter((member) => member.isGhost)}
        activeId={claim?.memberId}
        pending={claim?.pending ?? false}
        link={claim?.link}
        issue={claim?.issue}
        onCreate={(memberId) => {
          void createClaimLink(memberId);
        }}
      />
    </>
  );
}
