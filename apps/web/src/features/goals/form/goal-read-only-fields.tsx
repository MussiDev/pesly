'use client';

import { formatMoney, type GoalResponse } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { toGoalView } from '../helpers/goal-view';

/** The currency and the link of a goal cannot change, so they are text and not controls. */
export function GoalReadOnlyFields({ goal }: { goal: GoalResponse }) {
  const t = useTranslations('goals.form');
  return (
    <dl className="grid gap-3 text-body">
      <div className="grid gap-1">
        <dt className="text-small text-muted-foreground">{t('currency')}</dt>
        <dd>{goal.currency}</dd>
      </div>
      <div className="grid gap-1">
        <dt className="text-small text-muted-foreground">{t('account')}</dt>
        <dd>{goal.accountId === null ? t('accountNone') : t('accountLinked')}</dd>
      </div>
    </dl>
  );
}

/** The figures the API returned after a save; nothing here is computed. */
export function GoalSavedSummary({ goal }: { goal: GoalResponse }) {
  const t = useTranslations('goals.card');
  const locale = useLocale() as Locale;
  const view = toGoalView(goal);
  return (
    <div role="status" className="grid gap-1 rounded-card border bg-card p-4 text-body">
      <p>
        {t('progressOfTarget', {
          saved: formatMoney(view.progress, view.currency, locale),
          target: formatMoney(view.targetAmount, view.currency, locale),
        })}
      </p>
      {/* Rescales 0-100 to the 0-1 fraction the percent formatter expects (display, not money). */}
      <p>{t('percentage', { percent: view.percentage / 100 })}</p>
      {view.monthlyAmountNeeded === null ? null : (
        <p>
          {t('monthlyNeeded', {
            amount: formatMoney(view.monthlyAmountNeeded, view.currency, locale),
          })}
        </p>
      )}
    </div>
  );
}
