'use client';

import { RATE_TYPES } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';
import type { ApiFailure } from '@/lib/api-client';
import { GroupIssue } from './group-issue';

interface RateTypeFormProps {
  current: string;
  pending: boolean;
  saved: boolean;
  issue?: ApiFailure;
  /** The selected value as text; the container validates it. */
  onSubmit: (rateType: string) => void;
}

/** Changes the group's default rate type. */
export function RateTypeForm({ current, pending, saved, issue, onSubmit }: RateTypeFormProps) {
  const t = useTranslations('groups.detail.rateType');
  const tRate = useTranslations('profile.rateTypes');

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'defaultRateType'));
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-4">
      {issue ? <GroupIssue failure={issue} /> : null}
      <MovementField label={t('label')} hint={t('hint')} error={undefined}>
        {(control) => (
          <Select name="defaultRateType" defaultValue={current} {...control}>
            {RATE_TYPES.map((value) => (
              <option key={value} value={value}>
                {tRate(value)}
              </option>
            ))}
          </Select>
        )}
      </MovementField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
        {saved ? (
          <p role="status" className="text-small text-muted-foreground">
            {t('saved')}
          </p>
        ) : null}
      </div>
    </form>
  );
}
