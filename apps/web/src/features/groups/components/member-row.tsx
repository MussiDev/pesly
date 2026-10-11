'use client';

import type { GroupMemberResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from './group-issue';

interface MemberRowProps {
  member: GroupMemberResponse;
  /** Whether the promote and remove controls render at all (the caller is an admin). */
  canAdmin: boolean;
  busy: boolean;
  issue?: ApiFailure;
  onPromote: (memberId: string) => void;
  onRemove: (memberId: string) => void;
}

/** One current member: name, role, whether they have no account yet, and the admin controls. */
export function MemberRow({ member, canAdmin, busy, issue, onPromote, onRemove }: MemberRowProps) {
  const t = useTranslations('groups.detail');
  const name = member.displayName ?? t('unnamed');

  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-small font-semibold break-words">{name}</span>
        <Badge variant={member.role === 'admin' ? 'info' : 'default'}>
          {t(`roles.${member.role}`)}
        </Badge>
        {member.isGhost ? <Badge variant="outline">{t('ghost')}</Badge> : null}
      </div>
      {canAdmin ? (
        <div className="flex flex-wrap gap-2">
          {member.role === 'admin' ? null : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || member.isGhost}
              aria-label={t('actions.promoteLabel', { name })}
              onClick={() => {
                onPromote(member.id);
              }}
            >
              {t('actions.promote')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={t('actions.removeLabel', { name })}
            onClick={() => {
              onRemove(member.id);
            }}
          >
            {t('actions.remove')}
          </Button>
        </div>
      ) : null}
      {issue ? <GroupIssue failure={issue} /> : null}
    </li>
  );
}
