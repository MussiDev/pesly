import type { AccountCurrency } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { BalanceCard } from '@/components/ui/balance-card';
import { MinorAmount } from '@/features/accounts/components/accounts-headline';
import type { CurrencyTotals } from '@/features/accounts/totals';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export interface BalanceSummaryProps {
  locale: Locale;
  /** The currencies the user has accounts in: a currency without accounts shows no figure. */
  currencies: readonly AccountCurrency[];
  /** Minor-unit strings from the API; the client never adds them up. */
  availableTotals: CurrencyTotals;
  netWorthTotals: CurrencyTotals;
}

/** Per currency, what the user can spend as the large figure and net worth as the small one. */
export function BalanceSummary({
  locale,
  currencies,
  availableTotals,
  netWorthTotals,
}: BalanceSummaryProps) {
  const t = useTranslations('home.balance');

  return (
    <section aria-labelledby="home-balance-title" className="grid gap-3">
      <h2 id="home-balance-title" className="text-heading">
        {t('title')}
      </h2>
      <div className={cn('grid gap-3', currencies.length > 1 && 'sm:grid-cols-2')}>
        {currencies.map((currency) => (
          <BalanceCard
            key={currency}
            label={t(`currencies.${currency}`)}
            primaryLabel={t('available')}
            primary={
              <MinorAmount
                value={availableTotals[currency] ?? '0'}
                currency={currency}
                locale={locale}
                softDecimals
              />
            }
            secondaryLabel={t('netWorth')}
            secondary={
              <MinorAmount
                value={netWorthTotals[currency] ?? '0'}
                currency={currency}
                locale={locale}
              />
            }
          />
        ))}
      </div>
    </section>
  );
}
