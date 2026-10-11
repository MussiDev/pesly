'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiFailure } from '@/lib/api-client';
import { RateTypeForm } from './rate-type-form';

interface GroupAdminActionsProps {
  defaultRateType: string;
  pending: boolean;
  saved: boolean;
  issue?: ApiFailure;
  onChangeRateType: (rateType: string) => void;
}

/** The group-wide settings only an admin sees. Per-member actions live in each member row. */
export function GroupAdminActions({
  defaultRateType,
  pending,
  saved,
  issue,
  onChangeRateType,
}: GroupAdminActionsProps) {
  const t = useTranslations('groups.detail.rateType');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <RateTypeForm
          // A new key re-reads the selected value after the server confirmed a change.
          key={defaultRateType}
          current={defaultRateType}
          pending={pending}
          saved={saved}
          issue={issue}
          onSubmit={onChangeRateType}
        />
      </CardContent>
    </Card>
  );
}
