import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { DeleteUserContainer } from '@/features/profile/containers/delete-user-container';

export default function DeleteAccountPage() {
  const t = useTranslations('deleteUser');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <DeleteUserContainer />
    </main>
  );
}
