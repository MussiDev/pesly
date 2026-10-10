import type { AccountCurrency } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { CurrencyTotals } from '@/features/accounts/totals';
import type { Locale } from '@/i18n/routing';
import { BalanceSummary } from './balance-summary';
import { HomeAccounts, type HomeAccountItem } from './home-accounts';
import { HomeShortcuts } from './home-shortcuts';
import { MonthSummary } from './month-summary';
import { PendingPayment, type PendingPaymentProps } from './pending-payment';
import { QuickActions } from './quick-actions';
import { RecentMovements, type RecentMovementItem } from './recent-movements';

/** The header and spacing every home state shares, so no state moves the page around. */
export function HomeFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('home');
  const tApp = useTranslations('app');

  return (
    <div className="grid gap-6">
      {/* The top navigation carries the brand from `lg`; below it the home does. */}
      <p className="flex items-center gap-2.5 text-heading desk:hidden">
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-small font-semibold text-primary-foreground"
        >
          {tApp('brand').charAt(0)}
        </span>
        {tApp('brand')}
      </p>
      {/* The brand sits in the navigation; the page keeps its level-one heading for assistive technology. */}
      <h1 className="sr-only">{t('title')}</h1>
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
  /** The next recurring payment waiting for a confirmation, when there is one. */
  pendingPayment?: PendingPaymentProps;
}

export function HomeScreen({
  locale,
  timeZone,
  currencies,
  availableTotals,
  netWorthTotals,
  accounts,
  movements,
  pendingPayment,
}: HomeScreenProps) {
  return (
    <HomeFrame>
      <BalanceSummary
        locale={locale}
        currencies={currencies}
        availableTotals={availableTotals}
        netWorthTotals={netWorthTotals}
      />
      <MonthSummary />
      {pendingPayment === undefined ? null : <PendingPayment {...pendingPayment} />}
      <QuickActions />
      <div className="grid items-start gap-6 desk:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <RecentMovements locale={locale} timeZone={timeZone} items={movements} />
        <div className="grid gap-6">
          <HomeShortcuts />
          <HomeAccounts locale={locale} accounts={accounts} />
        </div>
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
        <Skeleton className="h-44 rounded-card" />
        <div className="grid grid-cols-3 gap-2 desk:gap-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="grid justify-items-center gap-2">
              <Skeleton className="size-circle-action rounded-pill" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
        <div className="grid items-start gap-6 desk:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="grid gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-64 rounded-card" />
          </div>
          <Skeleton className="h-56 rounded-card" />
        </div>
      </div>
    </HomeFrame>
  );
}
