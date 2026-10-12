'use client';

import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** Shown when the user has no goals; it offers to create the first one. */
export function GoalsEmptyState() {
  const t = useTranslations('goals.list.empty');
  return (
    <EmptyState
      icon={<Target aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/goals/new" className={buttonVariants({ size: 'sm' })}>
          {t('action')}
        </Link>
      }
    />
  );
}
