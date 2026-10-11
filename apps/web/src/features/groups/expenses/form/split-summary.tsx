'use client';

import { BASIS_POINTS_TOTAL } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format-amount';
import { formatPercentage } from './expense-request';

interface SplitSummaryProps {
  mode: 'percentage' | 'exact';
  /** Signed: basis points (percentage) or minor units (exact) still to assign; negative is over. */
  difference: bigint;
  currency: 'ARS' | 'USD';
  language: 'es' | 'en';
}

/** The running total against 100%, or the remaining amount against the expense total. */
export function SplitSummary({ mode, difference, currency, language }: SplitSummaryProps) {
  const t = useTranslations('groups.split.summary');
  const over = difference < 0n;
  const size = over ? -difference : difference;
  const balanced = difference === 0n;

  let lines: string[];
  if (mode === 'percentage') {
    const total = `${formatPercentage(BigInt(BASIS_POINTS_TOTAL) - difference, language)}%`;
    const value = `${formatPercentage(size, language)}%`;
    lines = balanced
      ? [t('percentageBalanced')]
      : [
          t('percentageTotal', { total }),
          over ? t('percentageOver', { value }) : t('percentageMissing', { value }),
        ];
  } else {
    const amount = formatMoney(size, currency, language);
    lines = [
      balanced
        ? t('exactBalanced')
        : over
          ? t('exactOver', { amount })
          : t('exactRemaining', { amount }),
    ];
  }

  return (
    <div
      role="status"
      className={balanced ? 'text-small text-muted-foreground' : 'text-small text-destructive'}
    >
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
