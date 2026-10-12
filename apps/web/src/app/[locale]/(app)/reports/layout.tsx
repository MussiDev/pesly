import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { ReportTabsBar } from '@/features/reports/components/report-tabs';

export default function ReportsLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('reports');

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 md:p-8">
      <PageHeader title={t('title')} />
      <ReportTabsBar />
      {children}
    </main>
  );
}
