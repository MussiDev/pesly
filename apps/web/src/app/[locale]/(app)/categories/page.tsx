import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { CategoriesContainer } from '@/features/categories/containers/categories-container';

export default function CategoriesPage() {
  const t = useTranslations('categories');

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-section p-page">
      <PageHeader title={t('title')} />
      <CategoriesContainer />
    </main>
  );
}
