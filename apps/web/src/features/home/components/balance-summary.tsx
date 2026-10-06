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

/**
 * The balance card: net worth as the large figure (in the first currency, since the client never
 * converts or adds across currencies) and, per currency, what the user can spend.
 */
export function BalanceSummary({
  locale,
  currencies,
  availableTotals,
  netWorthTotals,
}: BalanceSummaryProps) {
  const t = useTranslations('home.balance');
  const headline = currencies[0];

  return (
    <section
      aria-labelledby="home-balance-title"
      className="relative grid min-w-0 gap-4 overflow-hidden rounded-card bg-hero p-5 text-hero-foreground shadow-md"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-14 size-52 rounded-pill bg-hero-foreground/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-16 right-10 size-36 rounded-pill border border-hero-foreground/20"
      />
      <div className="relative grid min-w-0 gap-1">
        <h2 id="home-balance-title" className="text-small font-normal text-hero-muted">
          {t('netWorth')}
        </h2>
        {headline === undefined ? null : (
          <p className="text-display break-words [&_[data-slot=amount]]:whitespace-normal">
            <MinorAmount
              value={netWorthTotals[headline] ?? '0'}
              currency={headline}
              locale={locale}
              softDecimals
            />
          </p>
        )}
      </div>
      <div className={cn('relative grid gap-2', currencies.length > 1 && 'grid-cols-2')}>
        {currencies.map((currency) => (
          <dl
            key={currency}
            role="group"
            aria-label={t(`currencies.${currency}`)}
            className="grid min-w-0 gap-0.5 rounded-2xl border border-hero-foreground/20 bg-hero-foreground/10 px-4 py-3"
          >
            <dt className="text-caption text-hero-muted">
              {t('tile', { currency: t(`currenciesShort.${currency}`) })}
            </dt>
            <dd className="text-body font-semibold break-words [&_[data-slot=amount]]:whitespace-normal">
              <MinorAmount
                value={availableTotals[currency] ?? '0'}
                currency={currency}
                locale={locale}
              />
            </dd>
          </dl>
        ))}
      </div>
    </section>
  );
}
