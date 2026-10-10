import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { UpcomingContainer } from '@/features/recurring/containers/upcoming-container';

export default function RecurringPage() {
  const t = useTranslations('recurring');

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} description={t('description')} />
      <UpcomingContainer />
    </main>
  );
}
