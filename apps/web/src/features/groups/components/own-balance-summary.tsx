import { Plus, Scale } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { AccountCurrency } from '@pesly/shared';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format-amount';
import { cn } from '@/lib/utils';

export interface OwnBalanceLine {
  currency: AccountCurrency;
  /** Signed minor units: negative owes, positive is owed. */
  balance: bigint;
}

interface OwnBalanceSummaryProps {
  groupId: string;
  /** Undefined while the balances load, null when they could not be loaded. */
  lines: OwnBalanceLine[] | null | undefined;
}

const ACTION_CLASS =
  'inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-pill px-4 text-small font-bold transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-hero-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-hero-from [&>svg]:size-4.5 [&>svg]:shrink-0';

/**
 * The group's saturated card: the caller's balance in each currency, never mixed, and the two
 * actions a member takes most. The actions stay while the balance loads or fails.
 */
export function OwnBalanceSummary({ groupId, lines }: OwnBalanceSummaryProps) {
  const t = useTranslations('groups.detail');
  const language = useLocale() === 'en' ? 'en' : 'es';
  const groupHref = `/groups/${encodeURIComponent(groupId)}`;

  return (
    <section
      aria-label={t('ownBalance.title')}
      className="grid min-w-0 gap-4 rounded-card bg-hero px-5 pt-4.5 pb-5 text-hero-foreground"
    >
      <div className="grid min-w-0 gap-1">
        <h2 className="text-small font-normal text-hero-muted">{t('ownBalance.title')}</h2>
        {lines === undefined ? null : lines === null ? (
          <p className="text-small text-hero-muted">{t('ownBalance.unavailable')}</p>
        ) : (
          <ul className="grid min-w-0 gap-1">
            {lines.map(({ currency, balance }, index) => {
              const amount = formatMoney(balance < 0n ? -balance : balance, currency, language);
              return (
                <li
                  key={currency}
                  className={cn(
                    'break-words',
                    index === 0 ? 'text-title' : 'text-body text-hero-muted',
                  )}
                >
                  {balance === 0n
                    ? t('ownBalance.even', { currency })
                    : balance < 0n
                      ? t('ownBalance.owes', { amount })
                      : t('ownBalance.owed', { amount })}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`${groupHref}/expenses/new`}
          className={cn(ACTION_CLASS, 'bg-hero-foreground text-hero-from hover:bg-hero-muted')}
        >
          <Plus aria-hidden />
          <span className="min-w-0 truncate">{t('addExpenseLink')}</span>
        </Link>
        <Link
          href={`${groupHref}/balances`}
          className={cn(
            ACTION_CLASS,
            'border border-hero-foreground/35 bg-hero-foreground/10 hover:bg-hero-foreground/20',
          )}
        >
          <Scale aria-hidden />
          <span className="min-w-0 truncate">{t('balancesLink')}</span>
        </Link>
      </div>
    </section>
  );
}
