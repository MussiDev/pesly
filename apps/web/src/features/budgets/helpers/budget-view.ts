import type { BudgetSpendingResponse } from '@pesly/shared';

export interface BudgetMarker {
  /** The threshold as configured; it can be above 100. */
  value: number;
  /** Position on the bar, clamped to 0..100; for drawing only. */
  position: number;
  label: string;
}

export interface BudgetView {
  id: string;
  name: string;
  currency: BudgetSpendingResponse['currency'];
  month: string;
  /** Minor units, exactly as the API returned them; nothing here is added or divided. */
  amount: bigint;
  available: bigint;
  spent: bigint;
  remaining: bigint;
  rolloverEnabled: boolean;
  rolloverAmount: bigint;
  /** The integer percentage as received; it can be above 100 (up to 1,000). */
  percentage: number;
  /** The percentage clamped to 0..100; for drawing the bar only. */
  barWidth: number;
  overBudget: boolean;
  markers: BudgetMarker[];
  unconvertedShareCount: number;
  unconvertedInstallmentCount: number;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Display data of a budget for a month; every figure comes from the API. */
export function toBudgetView(spending: BudgetSpendingResponse): BudgetView {
  const remaining = BigInt(spending.remaining);
  return {
    id: spending.budgetId,
    name: spending.name,
    currency: spending.currency,
    month: spending.month,
    amount: BigInt(spending.amount),
    available: BigInt(spending.available),
    spent: BigInt(spending.spent),
    remaining,
    rolloverEnabled: spending.rolloverEnabled,
    rolloverAmount: BigInt(spending.rolloverAmount),
    percentage: spending.percentUsed,
    barWidth: clampPercent(spending.percentUsed),
    overBudget: remaining < 0n,
    markers: spending.thresholds.map((value) => ({
      value,
      position: clampPercent(value),
      label: `${value}`,
    })),
    unconvertedShareCount: spending.unconvertedShareCount,
    unconvertedInstallmentCount: spending.unconvertedInstallmentCount,
  };
}
