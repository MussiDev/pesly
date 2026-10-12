import type { GoalResponse } from '@pesly/shared';

export type GoalDisplayState = 'reached' | 'overdue' | 'active-with-monthly' | 'active';

export interface GoalView {
  id: string;
  name: string;
  currency: GoalResponse['currency'];
  targetDate: string | null;
  accountId: string | null;
  targetAmount: bigint;
  progress: bigint;
  /** Minor units, exactly as the API returned them. */
  monthlyAmountNeeded: bigint | null;
  /** The integer percentage as received; it can be negative or above 100. */
  percentage: number;
  /** The percentage clamped to 0..100; for drawing the bar only. */
  barWidth: number;
  state: GoalDisplayState;
}

function displayState(goal: GoalResponse): GoalDisplayState {
  if (goal.status === 'reached') return 'reached';
  if (goal.status === 'overdue') return 'overdue';
  return goal.monthlyAmountNeeded === null ? 'active' : 'active-with-monthly';
}

/** Display data of a goal; every figure comes from the API, none is computed here. */
export function toGoalView(goal: GoalResponse): GoalView {
  return {
    id: goal.id,
    name: goal.name,
    currency: goal.currency,
    targetDate: goal.targetDate,
    accountId: goal.accountId,
    targetAmount: BigInt(goal.targetAmount),
    progress: BigInt(goal.progress),
    monthlyAmountNeeded:
      goal.monthlyAmountNeeded === null ? null : BigInt(goal.monthlyAmountNeeded),
    percentage: goal.percentage,
    barWidth: Math.min(100, Math.max(0, goal.percentage)),
    state: displayState(goal),
  };
}
