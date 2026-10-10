import { useTranslations } from 'next-intl';
import { ComingSoon } from '@/features/shell/components/coming-soon';

export default function BudgetsPage() {
  const t = useTranslations('app.nav');

  return <ComingSoon title={t('budgets')} />;
}
