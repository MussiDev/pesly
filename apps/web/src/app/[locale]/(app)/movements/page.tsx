import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { MovementsContainer } from '@/features/movements/containers/movements-container';

export default function MovementsPage() {
  const t = useTranslations('movements');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <PageHeader title={t('title')} />
      <MovementsContainer />
    </main>
  );
}
