import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { NotificationsSettingsContainer } from '@/features/notifications/containers/notifications-settings-container';

export default function NotificationsSettingsPage() {
  const t = useTranslations('notifications');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <NotificationsSettingsContainer />
    </main>
  );
}
