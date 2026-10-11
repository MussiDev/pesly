'use client';

import { GROUP_NAME_MAX_LENGTH } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';
import type { ApiFailure } from '@/lib/api-client';
import type { GhostNameMessage } from '../ghost-request';
import { GroupIssue } from './group-issue';

interface AddGhostFormProps {
  pending: boolean;
  nameError?: GhostNameMessage;
  issue?: ApiFailure;
  /** Bumps after a member was added, so the field empties. */
  resetKey: number;
  onSubmit: (name: string) => void;
}

/** The display name of a member without an account. */
export function AddGhostForm({ pending, nameError, issue, resetKey, onSubmit }: AddGhostFormProps) {
  const t = useTranslations('groups.invite.ghost');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!nameError) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [nameError]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'displayName'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
        <p className="text-small text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-4">
          {issue ? <GroupIssue failure={issue} /> : null}
          <MovementField label={t('nameLabel')} error={nameError}>
            {(control) => (
              <Input
                key={resetKey}
                name="displayName"
                autoComplete="off"
                maxLength={GROUP_NAME_MAX_LENGTH * 2}
                {...control}
              />
            )}
          </MovementField>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? t('adding') : t('submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
