'use client';

import type { FormerGroupMemberResponse, GroupMemberResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { ApiFailure } from '@/lib/api-client';
import { MemberRow } from './member-row';

interface GroupMembersProps {
  members: readonly GroupMemberResponse[];
  formerMembers: readonly FormerGroupMemberResponse[];
  canAdmin: boolean;
  /** Whether a member action is in flight. */
  busy: boolean;
  /** The member the last failed action was about, and why it failed. */
  issue?: { memberId: string; failure: ApiFailure; selfRemoval?: boolean };
  onPromote: (memberId: string) => void;
  onRemove: (memberId: string) => void;
}

/** The current members, and apart from them the people who left or were removed. */
export function GroupMembers({
  members,
  formerMembers,
  canAdmin,
  busy,
  issue,
  onPromote,
  onRemove,
}: GroupMembersProps) {
  const t = useTranslations('groups.detail');

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <h2 className="text-heading">{t('membersTitle')}</h2>
        <ul
          className="divide-y divide-border/70 rounded-card bg-card px-4"
          aria-label={t('membersTitle')}
        >
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              canAdmin={canAdmin}
              busy={busy}
              issue={issue?.memberId === member.id ? issue.failure : undefined}
              issueIsSelfRemoval={issue?.memberId === member.id && issue.selfRemoval === true}
              onPromote={onPromote}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </section>
      {formerMembers.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="text-heading">{t('formerTitle')}</h2>
          <ul
            className="divide-y divide-border/70 rounded-card bg-card px-4 text-small text-muted-foreground"
            aria-label={t('formerTitle')}
          >
            {formerMembers.map((former) => (
              <li key={former.id} className="py-3 break-words">
                {former.displayName ?? t('unnamed')}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
