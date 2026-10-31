'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CardPurchasesNote } from '@/components/card-purchases-note';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { formatPeriod } from '@/features/credit-cards/format-dates';
import { Link } from '@/i18n/navigation';
import { BudgetDeleteAction } from '../delete/budget-delete-action';
import type { BudgetView } from '../helpers/budget-view';
import { BudgetProgress } from '../list/budget-progress';
import { UnconvertedNotice } from '../list/unconverted-notice';
import { BudgetCategories, type CoveredCategoryGroup } from './budget-categories';

interface BudgetDetailViewProps {
  view: BudgetView;
  groups: ReadonlyArray<CoveredCategoryGroup>;
  onDeleted: () => void;
}

/** One budget for a month: its figures, covered categories, thresholds and the edit and delete actions. */
export function BudgetDetailView({ view, groups, onDeleted }: BudgetDetailViewProps) {
  const t = useTranslations('budgets.detail');
  const tCard = useTranslations('budgets.card');
  const locale = useLocale();
  const thresholds = [...view.markers].sort((a, b) => a.value - b.value);
  return (
    <div className="grid gap-6">
      <PageHeader
        title={view.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/budgets/${encodeURIComponent(view.id)}/edit`}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('edit')}
            </Link>
          </div>
        }
      />
      <p className="text-small text-muted-foreground">
        {t('month', { month: formatPeriod(view.month, locale) })}
      </p>
      <BudgetProgress view={view} />
      <UnconvertedNotice
        shares={view.unconvertedShareCount}
        installments={view.unconvertedInstallmentCount}
      />
      <CardPurchasesNote />
      <BudgetCategories groups={groups} />
      <section className="grid gap-2">
        <h2 className="text-h3 font-semibold">{t('thresholds')}</h2>
        <ul aria-label={t('thresholds')} className="flex flex-wrap gap-2">
          {thresholds.map((marker) => (
            <li
              key={marker.value}
              className="rounded-full border bg-card px-3 py-1 text-small text-card-foreground"
            >
              {tCard('marker', { percent: marker.value / 100 })}
            </li>
          ))}
        </ul>
      </section>
      <BudgetDeleteAction budgetId={view.id} onDeleted={onDeleted} />
    </div>
  );
}
