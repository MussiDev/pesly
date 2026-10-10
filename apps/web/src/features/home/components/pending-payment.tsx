import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface PendingPaymentProps {
  name: string;
  /** The amount already formatted with its currency. */
  amount: string;
  /** The due date already formatted. */
  dueDate: string;
  overdue: boolean;
}

/** The next recurring payment that waits for a confirmation, one tap from the recurring page. */
export function PendingPayment({ name, amount, dueDate, overdue }: PendingPaymentProps) {
  const t = useTranslations('home.pending');

  return (
    <section
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning/10 px-4 py-3.5 text-warning"
    >
      <Clock aria-hidden className="size-5 shrink-0" />
      <div className="grid min-w-44 flex-1 gap-0.5">
        <p className="text-small font-bold">
          {overdue ? t('overdue', { name }) : t('due', { name })}
        </p>
        <p className="text-caption">{t('detail', { amount, date: dueDate })}</p>
      </div>
      <Link
        href="/recurring"
        className={cn(buttonVariants({ size: 'sm' }), 'bg-warning text-warning-foreground')}
      >
        {t('confirm')}
      </Link>
    </section>
  );
}
