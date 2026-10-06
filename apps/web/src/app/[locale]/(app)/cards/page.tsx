import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { CreditCardsContainer } from '@/features/credit-cards/containers/credit-cards-container';

export default function CreditCardsPage() {
  const t = useTranslations('creditCards');

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} />
      <CreditCardsContainer />
    </main>
  );
}
