'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/navigation';

/** The group does not exist or is not the user's; both look the same. */
export function GroupNotFoundView() {
  const t = useTranslations('groups.detail.notFound');
  return (
    <EmptyState
      icon={<Users aria-hidden="true" />}
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/groups" className={buttonVariants()}>
          {t('back')}
        </Link>
      }
    />
  );
}
