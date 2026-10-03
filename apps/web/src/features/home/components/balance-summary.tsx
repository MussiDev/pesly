import type { AccountCurrency } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { MinorAmount } from '@/features/accounts/components/accounts-headline';
import type { CurrencyTotals } from '@/features/accounts/totals';
import type { Locale } from '@/i18n/routing';

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
      <div className="grid gap-3 sm:grid-cols-2">
        {currencies.map((currency) => (
          <Card
            key={currency}
            role="group"
            aria-label={t(`currencies.${currency}`)}
            className="gap-2 p-4"
          >
            <dl className="grid gap-3">
              <div className="grid gap-1">
                <dt className="text-small text-muted-foreground">{t('available')}</dt>
                <dd className="text-display">
                  <MinorAmount
                    value={availableTotals[currency] ?? '0'}
                    currency={currency}
                    locale={locale}
                  />
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-small text-muted-foreground">{t('netWorth')}</dt>
                <dd className="text-body font-medium">
                  <MinorAmount
                    value={netWorthTotals[currency] ?? '0'}
                    currency={currency}
                    locale={locale}
                  />
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>
    </section>
  );
}
