'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from './group-issue';

interface LeaveGroupPanelProps {
  pending: boolean;
  /** Why leaving did not happen: a pending balance, or the caller being the last admin. */
  issue?: ApiFailure;
  onLeave: () => void;
}

export function LeaveGroupPanel({ pending, issue, onLeave }: LeaveGroupPanelProps) {
  const t = useTranslations('groups.detail.leave');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
        <p className="text-small text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {issue ? <GroupIssue failure={issue} /> : null}
        <div>
          <Button variant="destructive" disabled={pending} onClick={onLeave}>
            {pending ? t('working') : t('action')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
