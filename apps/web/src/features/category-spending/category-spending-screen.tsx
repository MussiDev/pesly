'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type {
  CategoryDetailItem,
  CategoryDetailResponse,
  CategoryDetailSource,
} from '@pesly/shared';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryRowLabel } from '@/features/reports/category-names';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { cn } from '@/lib/utils';
import { addMonth, monthRange } from './category-spending-month';

export type CategorySpendingState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'offline' }
  | { status: 'notFound' }
  | { status: 'ready'; data: CategoryDetailResponse };

export interface CategorySpendingScreenProps {
  locale: Locale;
  categoryId: string;
  month: string;
  state: CategorySpendingState;
  onRetry: () => void;
}

const SOURCES: readonly CategoryDetailSource[] = [
  'movement',
  'cardPurchase',
  'installment',
  'share',
];

function hrefOf(item: CategoryDetailItem): string | undefined {
  if (item.movementId !== null) return `/movements/edit?id=${item.movementId}`;
  if (item.cardId !== null) return `/cards/${item.cardId}`;
  if (item.group !== null) return `/groups/${item.group.id}`;
  return undefined;
}

/** Presentational: what one category adds up to in a month, as the dashboard counts it. */
export function CategorySpendingScreen({
  locale,
  categoryId,
  month,
  state,
  onRetry,
}: CategorySpendingScreenProps) {
  const t = useTranslations('categorySpending');
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  // Empty when the address has no valid month.
  const monthLabel =
    month === ''
      ? undefined
      : format.dateTime(new Date(`${month}-01T00:00:00Z`), {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        });
  const monthHref = (target: string) => `/categories/spending?id=${categoryId}&month=${target}`;

  let body;
  let title = t('title');
  switch (state.status) {
    case 'loading':
      body = (
        <div role="status" aria-busy="true" className="grid gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-24 w-full rounded-card" />
          <Skeleton className="h-48 w-full rounded-card" />
        </div>
      );
      break;
    case 'failed':
      body = <ErrorState title={t('failed')} retryLabel={t('retry')} onRetry={onRetry} />;
      break;
    case 'offline':
      body = <p className="text-small text-muted-foreground">{t('offline')}</p>;
      break;
    case 'notFound':
      body = <p className="text-small text-muted-foreground">{t('notFound')}</p>;
      break;
    case 'ready': {
      const { data } = state;
      title = categoryRowLabel(data, locale, { groupShares: t('title'), unnamed: t('title') });
      const currency = data.currency;
      const bySource = new Map<CategoryDetailSource, bigint>();
      for (const item of data.items) {
        if (item.amount === null) continue;
        bySource.set(item.source, (bySource.get(item.source) ?? 0n) + BigInt(item.amount));
      }
      const range = monthRange(data.month);
      const unconverted = data.unconvertedInstallmentCount + data.unconvertedShareCount;
      body = (
        <>
          <section aria-label={t('summary')} className="grid gap-3 rounded-card bg-card p-4">
            <div className="grid gap-0.5">
              <p className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
                {t('total')}
              </p>
              <p className="text-heading font-bold break-words tabular-nums">
                {formatMoney(BigInt(data.total), currency, locale)}
              </p>
            </div>
            {bySource.size > 0 ? (
              <dl className="grid gap-1.5">
                {SOURCES.filter((source) => bySource.has(source)).map((source) => (
                  <div key={source} className="flex items-baseline justify-between gap-3">
                    <dt className="text-small text-muted-foreground">{t(`sources.${source}`)}</dt>
                    <dd className="text-small font-semibold tabular-nums">
                      {formatMoney(bySource.get(source) ?? 0n, currency, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="text-caption text-muted-foreground">{t('howCounted')}</p>
            {unconverted > 0 ? (
              <p className="text-caption text-muted-foreground">
                {t('unconverted', { count: unconverted })}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="category-spending-items" className="grid gap-2">
            <h2
              id="category-spending-items"
              className="text-caption font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {t('items')}
            </h2>
            {data.items.length === 0 ? (
              <p className="text-small text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul role="list" className="grid divide-y divide-border rounded-card bg-card">
                {data.items.map((item) => {
                  const subcategory =
                    item.category === null || item.category.id === data.categoryId
                      ? undefined
                      : categoryRowLabel(
                          { categoryId: item.category.id, ...item.category },
                          locale,
                          { groupShares: '', unnamed: '' },
                        );
                  const name = item.label ?? subcategory ?? title;
                  const detail = [
                    item.source === 'movement' ? day(item.day) : null,
                    item.source === 'cardPurchase'
                      ? t('cardPurchase', { day: day(item.day) })
                      : null,
                    item.installment !== null
                      ? t('installment', {
                          number: item.installment.number,
                          count: item.installment.count,
                        })
                      : null,
                    item.dueDate === null ? null : t('due', { day: day(item.dueDate) }),
                    item.group === null
                      ? null
                      : t('share', { group: item.group.name, day: day(item.day) }),
                    item.label !== null && subcategory !== undefined ? subcategory : null,
                  ].filter((part): part is string => part !== null);
                  const original =
                    item.currency === currency
                      ? null
                      : formatMoney(BigInt(item.originalAmount), item.currency, locale);
                  const href = hrefOf(item);
                  const content = (
                    <>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="text-small font-semibold break-words">{name}</span>
                        <span className="text-caption text-muted-foreground">
                          {detail.join(' · ')}
                        </span>
                      </span>
                      <span className="grid shrink-0 justify-items-end gap-0.5">
                        <span className="text-small font-semibold text-expense tabular-nums">
                          {item.amount === null
                            ? t('noRate')
                            : formatMoney(BigInt(item.amount), currency, locale)}
                        </span>
                        {original === null ? null : (
                          <span className="text-caption text-muted-foreground tabular-nums">
                            {original}
                          </span>
                        )}
                      </span>
                    </>
                  );
                  const rowClass = 'flex min-h-14 items-center gap-3 px-4 py-3';
                  return (
                    <li key={item.key}>
                      {href === undefined ? (
                        <div className={rowClass}>{content}</div>
                      ) : (
                        <Link
                          href={href}
                          className={cn(
                            rowClass,
                            'transition-colors outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                          )}
                        >
                          {content}
                          <ChevronRight
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Link
            href={`/movements?type=expense&categoryId=${categoryId}&from=${range.from}&to=${range.to}`}
            className="inline-flex min-h-11 items-center text-small font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('viewMovements')}
          </Link>
        </>
      );
      break;
    }
  }

  return (
    <div className="grid gap-4">
      <header className="grid gap-2">
        {monthLabel === undefined ? null : (
          <div className="flex items-center justify-between gap-2">
            <Link
              href={monthHref(addMonth(month, -1))}
              aria-label={t('previousMonth')}
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            >
              <ChevronLeft aria-hidden />
            </Link>
            <p className="text-small font-semibold text-muted-foreground first-letter:uppercase">
              {monthLabel}
            </p>
            <Link
              href={monthHref(addMonth(month, 1))}
              aria-label={t('nextMonth')}
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            >
              <ChevronRight aria-hidden />
            </Link>
          </div>
        )}
        <h1 className="text-title break-words">{title}</h1>
      </header>
      {body}
    </div>
  );
}
