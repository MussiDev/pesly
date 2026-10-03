import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { ProfileContainer } from '@/features/profile/containers/profile-container';

export default function ProfileSettingsPage() {
  const t = useTranslations('profile');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ProfileContainer />
    </main>
  );
}
