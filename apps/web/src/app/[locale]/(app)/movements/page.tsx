import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { MovementsContainer } from '@/features/movements/containers/movements-container';

export default function MovementsPage() {
  const t = useTranslations('movements');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} />
      {/* useSearchParams needs a Suspense boundary to keep the page prerenderable. */}
      <Suspense>
        <MovementsContainer />
      </Suspense>
    </main>
  );
}
