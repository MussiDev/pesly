'use client';

import type { DefaultSplitResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBasisPointsInput } from './default-split-request';

export interface DefaultSplitReadonlyProps {
  defaultSplit: DefaultSplitResponse;
  /** Member display names by id; a missing name is shown as unnamed. */
  names: ReadonlyMap<string, string | null>;
}

/** The current default split for a member who cannot change it. */
export function DefaultSplitReadonly({ defaultSplit, names }: DefaultSplitReadonlyProps) {
  const t = useTranslations('groups.defaultSplit');
  const tDetail = useTranslations('groups.detail');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('currentTitle')}</CardTitle>
        <CardDescription>{t('readOnly')}</CardDescription>
      </CardHeader>
      <CardContent>
        {defaultSplit.mode === 'equal' ? (
          <p>{t('equalSummary')}</p>
        ) : (
          <ul className="grid gap-2">
            {defaultSplit.shares.map((share) => (
              <li key={share.memberId} className="flex justify-between gap-2">
                <span>{names.get(share.memberId) ?? tDetail('unnamed')}</span>
                <span>
                  {t('percentValue', { value: formatBasisPointsInput(share.basisPoints) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
