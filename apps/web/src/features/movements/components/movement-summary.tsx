'use client';

import { ArrowLeft, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatMoney } from '@pesly/shared';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { CategoryPie, type CategoryPieSegment } from '@/components/ui/category-pie';
import { Chip } from '@/components/ui/chip';
import { PillTabs } from '@/components/ui/pill-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import type { Locale } from '@/i18n/routing';
import { MOVEMENT_PERIODS, type MovementPeriod } from '../movement-period';
import type { MovementSummaryView, SummaryMoney } from '../movement-summary-view';

/** How many categories the legend lists before "show all". */
const VISIBLE_CATEGORIES = 5;

export type MovementSummaryState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; view: MovementSummaryView };

export interface MovementSummaryProps {
  locale: Locale;
  period: MovementPeriod;
  onPeriodChange: (period: (typeof MOVEMENT_PERIODS)[number]) => void;
  state: MovementSummaryState;
  /** The category the list is filtered by, with its name: its total heads the card. */
  selectedCategory?: { id: string; label: string } | undefined;
  onSelectCategory: (id: string) => void;
  /** Back to every category; offered while one is chosen. */
  onClearCategory?: (() => void) | undefined;
  /** Switches the breakdown (and the list) between expenses and income. */
  onBreakdownChange?: ((kind: 'expense' | 'income') => void) | undefined;
  onRetry: () => void;
}

/** A share in basis points as a whole percent; a sliver above zero reads "<1%". */
function percentText(basisPoints: number, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-AR');
  if (basisPoints > 0 && basisPoints < 50) return `<${formatter.format(1)}%`;
  return `${formatter.format(Math.round(basisPoints / 100))}%`;
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
      <dt className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      {shown.map((entry) => (
        <dd key={entry.currency} className="min-w-0">
          <Amount
            value={entry.amount}
            currency={entry.currency}
            locale={locale}
            kind={kind}
            directionLabel={label}
            className="text-heading font-bold"
          />
        </dd>
      ))}
    </div>
  );
}

/** What the filtered movements add up to and, on a ring, where they went; never fetches. */
export function MovementSummary({
  locale,
  period,
  onPeriodChange,
  state,
  selectedCategory,
  onSelectCategory,
  onClearCategory,
  onBreakdownChange,
  onRetry,
}: MovementSummaryProps) {
  const t = useTranslations('movements.summary');
  const [expanded, setExpanded] = useState(false);

  return (
    <section aria-label={t('title')} className="grid gap-4 rounded-card bg-card p-4">
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
          <Skeleton className="mx-auto size-48 rounded-pill" />
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
        <SummaryBody
          locale={locale}
          view={state.view}
          selectedCategory={selectedCategory}
          expanded={expanded}
          onToggleExpanded={() => {
            setExpanded((value) => !value);
          }}
          onSelectCategory={onSelectCategory}
          onClearCategory={onClearCategory}
          onBreakdownChange={onBreakdownChange}
        />
      )}
    </section>
  );
}

function SummaryBody({
  locale,
  view,
  selectedCategory,
  expanded,
  onToggleExpanded,
  onSelectCategory,
  onClearCategory,
  onBreakdownChange,
}: {
  locale: Locale;
  view: MovementSummaryView;
  selectedCategory: { id: string; label: string } | undefined;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelectCategory: (id: string) => void;
  onClearCategory: (() => void) | undefined;
  onBreakdownChange: ((kind: 'expense' | 'income') => void) | undefined;
}) {
  const t = useTranslations('movements.summary');
  const spentLabel = view.breakdown === 'income' ? t('earned') : t('spent');
  const segments: CategoryPieSegment[] = view.categories.map((category) => {
    const label = category.label ?? t('uncategorized');
    return {
      key: category.id ?? 'none',
      label,
      amounts: category.amounts.map((entry) =>
        formatMoney(entry.amount, entry.currency as 'ARS' | 'USD', locale),
      ),
      basisPoints: category.basisPoints,
      // Subcategories share their parent's colour; on their own ring they take distinct ones.
      color: selectedCategory === undefined ? category.color : undefined,
      detail: t('count', { count: category.count }),
      actionLabel: t('filterBy', { name: label }),
      // Movements without a category cannot be filtered on, so their row only informs.
      selectable: category.id !== null,
    };
  });

  return (
    <>
      {selectedCategory === undefined ? (
        <dl className="grid grid-cols-2 gap-3">
          <Figures amounts={view.expense} kind="expense" locale={locale} label={t('spent')} />
          <Figures amounts={view.income} kind="income" locale={locale} label={t('earned')} />
        </dl>
      ) : (
        <div className="grid gap-2">
          {onClearCategory === undefined ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 justify-self-start"
              onClick={onClearCategory}
            >
              <ArrowLeft aria-hidden />
              {t('allCategories')}
            </Button>
          )}
          <h2 className="text-title break-words">{selectedCategory.label}</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Figures
              amounts={view.breakdown === 'income' ? view.income : view.expense}
              kind={view.breakdown}
              locale={locale}
              label={t('categoryTotal')}
            />
            <div className="grid min-w-0 content-start gap-0.5">
              <dt className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
                {t('movementCount')}
              </dt>
              <dd className="text-heading font-bold tabular-nums">
                {view.categories.reduce((sum, category) => sum + category.count, 0)}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {onBreakdownChange === undefined ? null : (
        <PillTabs
          label={t('breakdownKind')}
          options={[
            { value: 'expense', label: t('expenses') },
            { value: 'income', label: t('incomes') },
          ]}
          value={view.breakdown}
          onChange={onBreakdownChange}
          className="justify-self-center"
        />
      )}

      {view.categories.length === 0 ? (
        <p className="text-small text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="grid gap-1">
          <h2 className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
            {selectedCategory !== undefined
              ? t('bySubcategory')
              : view.breakdown === 'income'
                ? t('byCategoryIncome')
                : t('byCategory')}
          </h2>
          <CategoryPie
            label={view.breakdown === 'income' ? t('byCategoryIncome') : t('byCategory')}
            segments={segments}
            formatPercent={(basisPoints) => percentText(basisPoints, locale)}
            selectedKey={selectedCategory?.id}
            onSelect={onSelectCategory}
            visibleRows={expanded ? undefined : VISIBLE_CATEGORIES}
            centre={
              view.leadCurrency === undefined ? undefined : (
                <>
                  <span className="text-caption text-muted-foreground">{spentLabel}</span>
                  <span className="text-caption font-bold tabular-nums">
                    {formatMoney(view.breakdownTotal, view.leadCurrency, locale)}
                  </span>
                </>
              )
            }
          />
          {view.categories.length > VISIBLE_CATEGORIES ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              onClick={onToggleExpanded}
            >
              {expanded ? t('showLess') : t('showAll', { count: view.categories.length })}
            </Button>
          ) : null}
        </div>
      )}
    </>
  );
}
