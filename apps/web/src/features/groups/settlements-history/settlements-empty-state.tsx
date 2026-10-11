'use client';

import { Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** A group with no recorded settlement yet. */
export function SettlementsEmptyState({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.settlements');

  return (
    <EmptyState
      icon={<Scale aria-hidden="true" />}
      title={t('emptyTitle')}
      description={t('emptyDescription')}
      action={
        <Link href={`/groups/${encodeURIComponent(groupId)}/balances`} className={buttonVariants()}>
          {t('emptyAction')}
        </Link>
      }
    />
  );
}
