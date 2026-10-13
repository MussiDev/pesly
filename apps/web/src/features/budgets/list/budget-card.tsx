'use client';

import { Link } from '@/i18n/navigation';
import type { BudgetView } from '../helpers/budget-view';
import { BudgetProgress } from './budget-progress';
import { UnconvertedNotice } from './unconverted-notice';

/** One budget for the month; the card opens its detail for that month. */
export function BudgetCard({ budget }: { budget: BudgetView }) {
  return (
    <li aria-label={budget.name} className="grid gap-3 rounded-card bg-card p-4">
      <Link
        href={`/budgets/${budget.id}?month=${budget.month}`}
        className="grid min-h-11 gap-3 focus-visible:outline-2"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-body font-medium">{budget.name}</span>
          <span className="text-small text-muted-foreground">{budget.currency}</span>
        </span>
        <BudgetProgress view={budget} />
      </Link>
      <UnconvertedNotice
        shares={budget.unconvertedShareCount}
        installments={budget.unconvertedInstallmentCount}
      />
    </li>
  );
}
