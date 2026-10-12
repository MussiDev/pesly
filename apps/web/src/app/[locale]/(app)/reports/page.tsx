import { redirect } from '@/i18n/navigation';

// `/reports` has no screen of its own: the first tab is the landing report.
export default async function ReportsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: '/reports/categories', locale });
}
