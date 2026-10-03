import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { AccountsContainer } from '@/features/accounts/containers/accounts-container';

export default function AccountsPage() {
  const t = useTranslations('accounts');

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <PageHeader title={t('title')} />
      <AccountsContainer />
    </main>
  );
}
