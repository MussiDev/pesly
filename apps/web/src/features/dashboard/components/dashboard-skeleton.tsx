import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardFrame, DashboardLayout, type SlotName } from './dashboard-screen';

const SLOT_NAMES: SlotName[] = [
  'netWorth',
  'kpis',
  'quickActions',
  'categories',
  'attention',
  'budgets',
  'upcoming',
  'groups',
  'insight',
];

/** The same slots, order and heights as the loaded screen; the net worth card comes first. */
export function DashboardSkeleton() {
  const t = useTranslations('dashboard.states');
  const slots = Object.fromEntries(
    SLOT_NAMES.map((name) => [name, <Skeleton key={name} className="size-full rounded-card" />]),
  );

  return (
    <DashboardFrame>
      <div role="status" aria-label={t('loading')} className="min-w-0">
        <DashboardLayout slots={slots} />
      </div>
    </DashboardFrame>
  );
}
