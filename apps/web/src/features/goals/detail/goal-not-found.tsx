'use client';

import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** The goal does not exist or is not the user's; both look the same. */
export function GoalNotFound() {
  const t = useTranslations('goals.detail.notFound');
  return (
    <EmptyState
      icon={<Target aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/goals" className={buttonVariants()}>
          {t('back')}
        </Link>
      }
    />
  );
}
