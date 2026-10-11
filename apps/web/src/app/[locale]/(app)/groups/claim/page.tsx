import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { ClaimSeatContainer } from '@/features/groups/containers/claim-seat-container';

export default function ClaimSeatPage() {
  const t = useTranslations('groups.join.claim');

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} />
      <ClaimSeatContainer />
    </main>
  );
}
