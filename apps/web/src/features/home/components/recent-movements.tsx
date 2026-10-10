import { exactIntegerStringSchema, type MovementType } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { Amount } from '@/components/ui/amount';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { MovementAvatar } from '@/features/movements/components/movement-avatar';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatDay } from '../time-zone';

export interface RecentMovementItem {
  id: string;
  type: MovementType;
  /** Minor-unit string from the API; anything but an exact integer renders a placeholder. */
  amount: string;
  /** `undefined` when the account is not among the loaded ones: the figure shows no symbol. */
  currency: string | undefined;
  occurredAt: string;
  note?: string | null;
  categoryName: string | undefined;
  categoryIcon: string | undefined;
  categoryColor: string | undefined;
  accountName: string | undefined;
}

export interface RecentMovementsProps {
  locale: Locale;
  timeZone: string;
  items: readonly RecentMovementItem[];
}

/** A figure without a currency symbol, for movements whose account is not among the loaded ones. */
function PlainAmount({
  value,
  locale,
  type,
  directionLabel,
}: {
  value: bigint;
  locale: Locale;
  type: MovementType;
  directionLabel: string;
}) {
  const directed = type === 'income' || type === 'expense';
  // Built from the integer parts, never through a float.
  const abs = value < 0n ? -value : value;
  const decimal = `${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimal as `${number}`);
  return (
    <span
      data-slot="amount"
      data-kind={directed ? type : 'neutral'}
      className={`text-small font-bold whitespace-nowrap tabular-nums ${directed ? (type === 'income' ? 'text-income' : 'text-expense') : ''}`}
    >
      {directed ? <span aria-hidden="true">{type === 'income' ? '+' : '−'}</span> : null}
      {directed ? <span className="sr-only">{directionLabel}</span> : null}
      {text}
    </span>
  );
}

export function RecentMovements({ locale, timeZone, items }: RecentMovementsProps) {
  const t = useTranslations('home.recent');

  if (items.length === 0) {
    return (
      <EmptyState
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <Link href="/movements/new" className={buttonVariants()}>
            {t('empty.action')}
          </Link>
        }
      />
    );
  }

  return (
    <section aria-labelledby="home-recent-title" className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-recent-title" className="text-heading">
          {t('title')}
        </h2>
        <Link href="/movements" className={buttonVariants({ variant: 'link', size: 'sm' })}>
          {t('seeAll')}
        </Link>
      </div>
      <ul
        aria-labelledby="home-recent-title"
        className="divide-y divide-border/70 rounded-card bg-card px-4 shadow-xs"
      >
        {items.map((item) => {
          const category =
            item.type === 'transfer' || item.type === 'exchange'
              ? t(item.type)
              : (item.categoryName ?? t('unknownCategory'));
          const when = formatDay(item.occurredAt, locale, timeZone);
          const parsed = exactIntegerStringSchema.safeParse(item.amount);
          const hasNote = item.note !== undefined && item.note !== null && item.note !== '';
          return (
            <ListRow
              key={item.id}
              as="li"
              leading={
                <MovementAvatar
                  type={item.type}
                  note={item.note}
                  categoryIcon={item.categoryIcon}
                  categoryColor={item.categoryColor}
                />
              }
              title={hasNote ? item.note : category}
              description={
                hasNote
                  ? `${category} · ${item.accountName ?? t('unknownAccount')}`
                  : (item.accountName ?? t('unknownAccount'))
              }
              trailing={
                <span className="grid justify-items-end gap-0.5">
                  {!parsed.success ? (
                    <span className="text-muted-foreground">—</span>
                  ) : item.currency === undefined ? (
                    <PlainAmount
                      value={BigInt(parsed.data)}
                      locale={locale}
                      type={item.type}
                      directionLabel={t(item.type)}
                    />
                  ) : (
                    <Amount
                      value={BigInt(parsed.data)}
                      currency={item.currency}
                      locale={locale}
                      kind={
                        item.type === 'income' || item.type === 'expense' ? item.type : 'neutral'
                      }
                      directionLabel={t(item.type)}
                      className="text-small font-bold"
                    />
                  )}
                  <time dateTime={item.occurredAt} className="text-caption text-muted-foreground">
                    {when}
                  </time>
                </span>
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
