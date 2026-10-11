'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from './group-issue';
import { ShareLink } from './share-link';

export interface InvitationView {
  link: string;
  /** The expiry, already formatted in the user's time zone. */
  expiresOn: string;
}

interface InvitePanelProps {
  pending: boolean;
  invitation?: InvitationView;
  issue?: ApiFailure;
  onCreate: () => void;
}

/** Asks for an invitation link and shows it with its expiry, a copy action and, if any, share. */
export function InvitePanel({ pending, invitation, issue, onCreate }: InvitePanelProps) {
  const t = useTranslations('groups.invite');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
        <p className="text-small text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {issue ? <GroupIssue failure={issue} /> : null}
        {invitation ? (
          <div className="grid gap-2">
            <ShareLink key={invitation.link} link={invitation.link} />
            <p className="text-small text-muted-foreground">
              {t('expires', { date: invitation.expiresOn })}
            </p>
          </div>
        ) : null}
        <div>
          <Button variant="outline" disabled={pending} onClick={onCreate}>
            {pending ? t('creating') : t('create')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
