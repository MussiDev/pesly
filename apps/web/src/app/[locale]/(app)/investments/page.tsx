import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { InvestmentsContainer } from '@/features/investments/containers/investments-container';

export default function InvestmentsPage() {
  const t = useTranslations('investments');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-section p-page md:p-8">
      <PageHeader title={t('title')} description={t('description')} />
      <InvestmentsContainer />
    </main>
  );
}
