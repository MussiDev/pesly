'use client';

import { formatMoney, type BudgetResponse } from '@pesly/shared';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';

/** The currency of a budget cannot change, so it is text and not a control. */
export function BudgetReadOnlyFields({ budget }: { budget: BudgetResponse }) {
  const t = useTranslations('budgets.form');
  return (
    <dl className="grid gap-3 text-body">
      <div className="grid gap-1">
        <dt className="text-small text-muted-foreground">{t('currency')}</dt>
        <dd>{budget.currency}</dd>
        <dd className="text-small text-muted-foreground">{t('currencyReadOnly')}</dd>
      </div>
    </dl>
  );
}

/** The values the API returned after a save; nothing here is computed. */
export function BudgetSavedSummary({ budget }: { budget: BudgetResponse }) {
  const t = useTranslations('budgets.detail');
  const format = useFormatter();
  const locale = useLocale() as Locale;
  // Display only: the percent formatter takes the 0-1 fraction of the whole number.
  const thresholds = [...budget.thresholds]
    .sort((a, b) => a - b)
    .map((value) => format.number(value / 100, { style: 'percent' }))
    .join(', ');
  return (
    <div role="status" className="grid gap-1 rounded-card border bg-card p-4 text-body">
      <p className="font-medium">{budget.name}</p>
      <p>{formatMoney(BigInt(budget.amount), budget.currency, locale)}</p>
      <p>
        {t('thresholds')}: {thresholds}
      </p>
    </div>
  );
}
