'use client';

import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryVisual } from '@/features/categories/components/category-visual';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { MOVEMENT_PERIODS, type MovementPeriod } from '../movement-period';
import type { MovementSummaryView, SummaryCategory, SummaryMoney } from '../movement-summary-view';

/** How many categories show before "show all". */
const VISIBLE_CATEGORIES = 3;

export type MovementSummaryState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; view: MovementSummaryView };

export interface MovementSummaryProps {
  locale: Locale;
  period: MovementPeriod;
  onPeriodChange: (period: (typeof MOVEMENT_PERIODS)[number]) => void;
  state: MovementSummaryState;
  /** The category the list is filtered by: its row shows but does not filter again. */
  selectedCategoryId?: string | undefined;
  onSelectCategory: (id: string) => void;
  onRetry: () => void;
}

function Figures({
  amounts,
  kind,
  locale,
  label,
}: {
  amounts: readonly SummaryMoney[];
  kind: 'expense' | 'income';
  locale: Locale;
  label: string;
}) {
  // Nothing in a currency is still a figure: zero pesos, never an empty box.
  const shown = amounts.length === 0 ? [{ currency: 'ARS', amount: 0n }] : amounts;
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      {shown.map((entry) => (
        <dd key={entry.currency} className="min-w-0">
          <Amount
            value={entry.amount}
            currency={entry.currency}
            locale={locale}
            kind={kind}
            directionLabel={label}
            className="text-body font-bold"
          />
        </dd>
      ))}
    </div>
  );
}

function CategoryLine({
  category,
  locale,
  kind,
  selected,
  onSelect,
}: {
  category: SummaryCategory;
  locale: Locale;
  kind: 'expense' | 'income';
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('movements.summary');
  const label = category.label ?? t('uncategorized');
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <CategoryVisual
          icon={category.icon ?? ''}
          color={category.color ?? ''}
          className="size-9 shrink-0"
        />
        <span className="grid min-w-0 flex-1 gap-0.5 text-left">
          <span className="truncate text-small font-semibold">{label}</span>
          <span className="text-caption text-muted-foreground">
            {t('count', { count: category.count })}
          </span>
        </span>
        <span className="grid shrink-0 justify-items-end">
          {category.amounts.map((entry) => (
            <Amount
              key={entry.currency}
              value={entry.amount}
              currency={entry.currency}
              locale={locale}
              kind={kind}
              className="text-small font-semibold"
            />
          ))}
        </span>
      </span>
      <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-pill bg-muted">
        <span
          data-slot="share-bar"
          className="block h-full rounded-pill bg-primary"
          style={{ width: `${Math.min(100, Math.max(0, category.share))}%` }}
        />
      </span>
    </>
  );
  const className = 'grid w-full gap-2 rounded-xl px-2 py-2.5';
  if (category.id === null || selected) {
    return <div className={className}>{body}</div>;
  }
  const id = category.id;
  return (
    <button
      type="button"
      aria-label={t('filterBy', { name: label })}
      className={cn(
        className,
        'cursor-pointer transition-colors outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
      )}
      onClick={() => {
        onSelect(id);
      }}
    >
      {body}
    </button>
  );
}

/** What the filtered movements add up to and where they went; never fetches. */
export function MovementSummary({
  locale,
  period,
  onPeriodChange,
  state,
  selectedCategoryId,
  onSelectCategory,
  onRetry,
}: MovementSummaryProps) {
  const t = useTranslations('movements.summary');
  const [expanded, setExpanded] = useState(false);

  return (
    <section aria-label={t('title')} className="grid gap-4 rounded-card bg-card p-4 shadow-xs">
      <div role="group" aria-label={t('period')} className="-mx-1 flex gap-2 overflow-x-auto px-1">
        {MOVEMENT_PERIODS.map((option) => (
          <Chip
            key={option}
            pressed={period === option}
            className="px-3"
            onClick={() => {
              onPeriodChange(option);
            }}
          >
            {t(`periods.${option}`)}
          </Chip>
        ))}
        {period === 'custom' ? (
          <Chip pressed disabled className="px-3">
            {t('periods.custom')}
          </Chip>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <div role="status" aria-busy="true" className="grid gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : state.kind === 'failed' ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-small text-muted-foreground">{t('failed')}</p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden />
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <Figures
              amounts={state.view.expense}
              kind="expense"
              locale={locale}
              label={t('spent')}
            />
            <Figures
              amounts={state.view.income}
              kind="income"
              locale={locale}
              label={t('earned')}
            />
          </dl>
          {state.view.categories.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="grid gap-1">
              <h2 className="text-small font-semibold">
                {state.view.breakdown === 'income' ? t('byCategoryIncome') : t('byCategory')}
              </h2>
              <ul role="list" className="-mx-2 grid">
                {(expanded
                  ? state.view.categories
                  : state.view.categories.slice(0, VISIBLE_CATEGORIES)
                ).map((category) => (
                  <li key={category.id ?? 'none'}>
                    <CategoryLine
                      category={category}
                      locale={locale}
                      kind={state.view.breakdown}
                      selected={category.id === selectedCategoryId}
                      onSelect={onSelectCategory}
                    />
                  </li>
                ))}
              </ul>
              {state.view.categories.length > VISIBLE_CATEGORIES ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={expanded}
                  onClick={() => {
                    setExpanded((value) => !value);
                  }}
                >
                  {expanded ? t('showLess') : t('showAll', { count: state.view.categories.length })}
                </Button>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
