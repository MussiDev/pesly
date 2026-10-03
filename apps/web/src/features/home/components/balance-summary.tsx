import type { AccountCurrency } from '@pesly/shared';
import { useTranslations } from 'next-intl';
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
          <div
            key={currency}
            role="group"
            aria-label={t(`currencies.${currency}`)}
            className="relative overflow-hidden rounded-2xl bg-hero p-5 text-hero-foreground shadow-md"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full bg-hero-foreground/10 blur-2xl"
            />
            <dl className="relative grid gap-4">
              <div className="grid gap-1">
                <dt className="text-small text-hero-muted">{t('available')}</dt>
                <dd className="text-display">
                  <MinorAmount
                    value={availableTotals[currency] ?? '0'}
                    currency={currency}
                    locale={locale}
                    softDecimals
                  />
                </dd>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-hero-foreground/10 px-3 py-2">
                <dt className="text-small text-hero-muted">{t('netWorth')}</dt>
                <dd className="text-small font-semibold">
                  <MinorAmount
                    value={netWorthTotals[currency] ?? '0'}
                    currency={currency}
                    locale={locale}
                  />
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
