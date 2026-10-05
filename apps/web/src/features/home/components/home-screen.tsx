import type { AccountCurrency } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import type { CurrencyTotals } from '@/features/accounts/totals';
import type { Locale } from '@/i18n/routing';
import { BalanceSummary } from './balance-summary';
import { HomeAccounts, type HomeAccountItem } from './home-accounts';
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
  accounts: readonly HomeAccountItem[];
  movements: readonly RecentMovementItem[];
}

export function HomeScreen({
  locale,
  timeZone,
  currencies,
  availableTotals,
  netWorthTotals,
  accounts,
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
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <RecentMovements locale={locale} timeZone={timeZone} items={movements} />
        <HomeAccounts locale={locale} accounts={accounts} />
      </div>
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
            <Skeleton className="h-40 rounded-card" />
            <Skeleton className="h-40 rounded-card" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      </div>
    </HomeFrame>
  );
}
