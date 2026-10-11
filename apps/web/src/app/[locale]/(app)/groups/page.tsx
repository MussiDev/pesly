import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { GroupsListContainer } from '@/features/groups/containers/groups-list-container';
import { Link } from '@/i18n/navigation';

export default function GroupsPage() {
  const t = useTranslations('groups.list');

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/groups/shares" className={buttonVariants({ variant: 'outline' })}>
            {t('sharesLink')}
          </Link>
        }
      />
      <GroupsListContainer />
    </main>
  );
}
