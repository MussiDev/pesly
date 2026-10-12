'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatPeriod } from '@/features/credit-cards/format-dates';

interface MonthSelectorProps {
  /** `YYYY-MM`, the month on screen. */
  month: string;
  isCurrent: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** Previous action, the month for the locale and, only on an earlier month, a next action (FR-04). */
export function MonthSelector({
  month,
  isCurrent,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: MonthSelectorProps) {
  const t = useTranslations('budgets.list.month');
  const locale = useLocale();
  return (
    <div role="group" aria-label={t('label')} className="flex items-center justify-between gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('previous')}
        disabled={!canPrevious}
        onClick={onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <div className="grid justify-items-center">
        <span aria-live="polite" className="text-body font-medium capitalize">
          {formatPeriod(month, locale)}
        </span>
        {isCurrent ? (
          <span className="text-small text-muted-foreground">{t('current')}</span>
        ) : null}
      </div>
      {canNext ? (
        <Button variant="ghost" size="icon" aria-label={t('next')} onClick={onNext}>
          <ChevronRight aria-hidden="true" />
        </Button>
      ) : (
        <span className="size-11" aria-hidden="true" />
      )}
    </div>
  );
}
