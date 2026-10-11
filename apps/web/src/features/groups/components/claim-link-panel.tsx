'use client';

import type { GroupMemberResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from './group-issue';
import { ShareLink } from './share-link';

interface ClaimLinkPanelProps {
  /** The members without an account. */
  ghosts: GroupMemberResponse[];
  /** The member the pending request or shown result belongs to. */
  activeId?: string;
  pending: boolean;
  link?: string;
  issue?: ApiFailure;
  onCreate: (memberId: string) => void;
}

/** One claim link action per member without an account; the result shows under its member. */
export function ClaimLinkPanel({
  ghosts,
  activeId,
  pending,
  link,
  issue,
  onCreate,
}: ClaimLinkPanelProps) {
  const t = useTranslations('groups.invite.claim');
  const tDetail = useTranslations('groups.detail');
  if (ghosts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
        <p className="text-small text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4">
          {ghosts.map((ghost) => {
            const name = ghost.displayName ?? tDetail('unnamed');
            const active = ghost.id === activeId;
            return (
              <li key={ghost.id} className="grid gap-2">
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-full py-2 text-left break-words whitespace-normal"
                    disabled={pending}
                    onClick={() => {
                      onCreate(ghost.id);
                    }}
                  >
                    {pending && active ? t('creating') : t('create', { name })}
                  </Button>
                </div>
                {active && issue ? <GroupIssue failure={issue} /> : null}
                {active && link ? <ShareLink key={link} link={link} /> : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
