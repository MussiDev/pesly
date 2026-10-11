import { useLocale, useTranslations } from 'next-intl';
import type { AccountCurrency } from '@pesly/shared';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format-amount';
import type { MemberBalanceRow } from '../settlements/balance-view';

const VARIANT = { owes: 'destructive', owed: 'success', even: 'outline' } as const;

/** One member's balance: name, amount and a text badge, so the state never relies on colour. */
export function MemberBalanceItem({
  row,
  currency,
}: {
  row: MemberBalanceRow;
  currency: AccountCurrency;
}) {
  const t = useTranslations('groups.balances');
  const tDetail = useTranslations('groups.detail');
  const language = useLocale() === 'en' ? 'en' : 'es';
  const magnitude = row.balance < 0n ? -row.balance : row.balance;

  return (
    <li data-member-row className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex items-center gap-2">
        <span className="font-medium">{row.name ?? tDetail('unnamed')}</span>
        {row.isSelf ? <span className="text-caption text-muted-foreground">{t('you')}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        {row.status === 'even' ? null : <span>{formatMoney(magnitude, currency, language)}</span>}
        <Badge variant={VARIANT[row.status]}>{t(row.status)}</Badge>
      </span>
    </li>
  );
}
