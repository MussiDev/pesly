'use client';

import { ACCOUNT_CURRENCIES, exactIntegerStringSchema } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Amount } from '@/components/ui/amount';
import { Card } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import type { CurrencyTotals } from '../totals';

interface MinorAmountProps {
  /** A minor-unit string from the API; anything but an exact integer renders a placeholder. */
  value: string;
  currency: string;
  locale: Locale;
  className?: string;
  softDecimals?: boolean;
}

/**
 * `Amount` for an API string. The old `formatAmount` threw on a malformed value; here it shows a
 * dash instead, so one bad figure never takes the whole screen down.
 */
export function MinorAmount({
  value,
  currency,
  locale,
  className,
  softDecimals,
}: MinorAmountProps) {
  const parsed = exactIntegerStringSchema.safeParse(value);
  if (!parsed.success) return <span className="text-muted-foreground">—</span>;
  return (
    <Amount
      value={BigInt(parsed.data)}
      currency={currency}
      locale={locale}
      className={className}
      softDecimals={softDecimals}
    />
  );
}

export interface AccountsHeadlineProps {
  /** Minor-unit strings per currency: what the user can spend (included accounts). */
  availableTotals: CurrencyTotals;
  /** Minor-unit strings per currency: every active account, card debt included. */
  netWorthTotals: CurrencyTotals;
}

/** Per currency, Available as the main figure and Net worth as the smaller secondary one. */
export function AccountsHeadline({ availableTotals, netWorthTotals }: AccountsHeadlineProps) {
  const t = useTranslations('accounts');
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ACCOUNT_CURRENCIES.map((currency) => (
        <Card
          key={currency}
          role="group"
          aria-label={t(`currencies.${currency}`)}
          className="gap-3 p-4"
        >
          <dl className="grid gap-3">
            <div className="grid gap-1">
              <dt className="text-small text-muted-foreground">{t('headline.available')}</dt>
              <dd className="text-display">
                <MinorAmount
                  value={availableTotals[currency] ?? '0'}
                  currency={currency}
                  locale={locale}
                />
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-small text-muted-foreground">{t('headline.netWorth')}</dt>
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
  );
}
