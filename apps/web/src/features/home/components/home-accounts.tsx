import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { MinorAmount } from '@/features/accounts/components/accounts-headline';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

export interface HomeAccountItem {
  id: string;
  name: string;
  currency: string;
  /** Minor-unit string from the API; anything but an exact integer renders a placeholder. */
  balance: string;
}

export interface HomeAccountsProps {
  locale: Locale;
  accounts: readonly HomeAccountItem[];
}

/** The accounts already loaded for the balance, with their own balance; the full list is one link away. */
export function HomeAccounts({ locale, accounts }: HomeAccountsProps) {
  const t = useTranslations('home.accounts');
  if (accounts.length === 0) return null;

  return (
    <section aria-labelledby="home-accounts-title" className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-accounts-title" className="text-heading">
          {t('title')}
        </h2>
        <Link href="/accounts" className={buttonVariants({ variant: 'link', size: 'sm' })}>
          {t('seeAll')}
        </Link>
      </div>
      <ul
        aria-labelledby="home-accounts-title"
        className="divide-y divide-border/70 rounded-card bg-card px-4 shadow-xs"
      >
        {accounts.map((account) => (
          <ListRow
            key={account.id}
            as="li"
            leading={<Avatar fallback={account.currency} />}
            title={account.name}
            trailing={
              <MinorAmount
                value={account.balance}
                currency={account.currency}
                locale={locale}
                className="font-semibold"
              />
            }
          />
        ))}
      </ul>
    </section>
  );
}
