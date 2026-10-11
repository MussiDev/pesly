import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { JoinGroupContainer } from '@/features/groups/containers/join-group-container';

export default function JoinGroupPage() {
  const t = useTranslations('groups.join.join');

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4 md:p-8">
      <PageHeader title={t('title')} />
      <JoinGroupContainer />
    </main>
  );
}
