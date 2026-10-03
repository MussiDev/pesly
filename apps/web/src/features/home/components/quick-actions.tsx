import { Plus, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export function QuickActions() {
  const t = useTranslations('home.quickActions');

  return (
    <section aria-label={t('title')} className="grid gap-3 sm:grid-cols-2">
      <Link href="/movements/new" className={buttonVariants({ size: 'lg' })}>
        <Plus aria-hidden />
        {t('addMovement')}
      </Link>
      <Link href="/accounts/new" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        <Wallet aria-hidden />
        {t('addAccount')}
      </Link>
    </section>
  );
}
