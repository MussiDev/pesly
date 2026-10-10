import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { NoticesContainer } from '@/features/notices/containers/notices-container';

export default function NoticesPage() {
  const t = useTranslations('notices');

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} description={t('description')} />
      <NoticesContainer />
    </main>
  );
}
