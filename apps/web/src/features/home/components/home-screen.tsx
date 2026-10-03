import type { AccountCurrency } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import type { CurrencyTotals } from '@/features/accounts/totals';
import type { Locale } from '@/i18n/routing';
import { BalanceSummary } from './balance-summary';
import { QuickActions } from './quick-actions';
import { RecentMovements, type RecentMovementItem } from './recent-movements';

/** The header and spacing every home state shares, so no state moves the page around. */
export function HomeFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('home');

  return (
    <div className="grid gap-6">
      <PageHeader title={t('title')} description={t('tagline')} />
      {children}
    </div>
  );
}

export interface HomeScreenProps {
  locale: Locale;
  timeZone: string;
  currencies: readonly AccountCurrency[];
  availableTotals: CurrencyTotals;
  netWorthTotals: CurrencyTotals;
  movements: readonly RecentMovementItem[];
}

export function HomeScreen({
  locale,
  timeZone,
  currencies,
  availableTotals,
  netWorthTotals,
  movements,
}: HomeScreenProps) {
  return (
    <HomeFrame>
      <BalanceSummary
        locale={locale}
        currencies={currencies}
        availableTotals={availableTotals}
        netWorthTotals={netWorthTotals}
      />
      <QuickActions />
      <RecentMovements locale={locale} timeZone={timeZone} items={movements} />
    </HomeFrame>
  );
}

/** Same sections and rough heights as the loaded home, so the content does not jump in. */
export function HomeSkeleton() {
  const t = useTranslations('ui');

  return (
    <HomeFrame>
      <div role="status" aria-label={t('loading')} className="grid gap-6">
        <div className="grid gap-3">
          <Skeleton className="h-6 w-32" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-64" />
        </div>
      </div>
    </HomeFrame>
  );
}
