'use client';

import { formatMoney } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { Locale } from '@/i18n/routing';
import type { GoalView } from '../helpers/goal-view';

/** The progress bar, the saved-of-target amounts and the state of a goal; every figure is as the API returned it. */
export function GoalProgress({ goal }: { goal: GoalView }) {
  const t = useTranslations('goals.card');
  const locale = useLocale() as Locale;
  // Only rescales 0-100 to the 0-1 fraction the locale percent formatter expects (display, not money).
  const percentLabel = t('percentage', { percent: goal.percentage / 100 });

  return (
    <div className="grid gap-2">
      <div
        role="progressbar"
        aria-label={percentLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={goal.barWidth}
        className="h-2 w-full overflow-hidden rounded-pill bg-muted"
      >
        <div
          data-testid="goal-bar-fill"
          className="h-full rounded-pill bg-primary"
          style={{ width: `${goal.barWidth}%` }}
        />
      </div>
      <p className="text-small tabular-nums">
        {t('progressOfTarget', {
          saved: formatMoney(goal.progress, goal.currency, locale),
          target: formatMoney(goal.targetAmount, goal.currency, locale),
        })}
      </p>
      <p className="text-small text-muted-foreground">{percentLabel}</p>
      <GoalStateBadge goal={goal} />
    </div>
  );
}

function GoalStateBadge({ goal }: { goal: GoalView }) {
  const t = useTranslations('goals.card');
  const locale = useLocale() as Locale;

  if (goal.state === 'reached') return <Badge variant="success">{t('reached')}</Badge>;
  if (goal.state === 'overdue') return <Badge variant="destructive">{t('overdue')}</Badge>;
  if (goal.state === 'active-with-monthly' && goal.monthlyAmountNeeded !== null) {
    return (
      <Badge variant="info">
        {t('monthlyNeeded', {
          amount: formatMoney(goal.monthlyAmountNeeded, goal.currency, locale),
        })}
      </Badge>
    );
  }
  return null;
}
