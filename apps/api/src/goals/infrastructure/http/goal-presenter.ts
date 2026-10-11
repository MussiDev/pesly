import {
  formatMinorUnitsString,
  type GoalEntryResponse,
  type GoalResponse,
  type ListGoalEntriesResponse,
  type ListGoalsResponse,
  type RecordGoalEntryResponse,
} from '@pesly/shared';
import type { GoalView } from '../../application/goal-view';
import type { GoalEntry } from '../../domain/goal';

const MAX_SAFE_PERCENTAGE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * The percentage is a count of percent points, not money. It is a bigint inside so a huge
 * over-funded goal stays exact; the contract is a JSON integer, so it is clamped to the largest
 * integer a JSON number carries exactly. `parseInt` over the decimal text avoids a float
 * conversion of a bigint.
 */
function percentageToInteger(percentage: bigint): number {
  const bounded = percentage > MAX_SAFE_PERCENTAGE ? MAX_SAFE_PERCENTAGE : percentage;
  return Number.parseInt(bounded.toString(), 10);
}

/** The only place where `bigint` amounts become decimal strings and dates become ISO strings. */
export function presentGoal(goal: GoalView): GoalResponse {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: formatMinorUnitsString(goal.targetAmount),
    currency: goal.currency,
    targetDate: goal.targetDate,
    accountId: goal.accountId,
    // Plain bigint toString: a linked goal's progress is a derived balance and may be negative.
    progress: formatMinorUnitsString(goal.progress),
    percentage: percentageToInteger(goal.percentage),
    status: goal.status,
    monthlyAmountNeeded:
      goal.monthlyAmountNeeded === null ? null : formatMinorUnitsString(goal.monthlyAmountNeeded),
    createdAt: goal.createdAt.toISOString(),
  };
}

export function presentGoalList(goals: readonly GoalView[]): ListGoalsResponse {
  return { goals: goals.map(presentGoal) };
}

export function presentGoalEntry(entry: GoalEntry): GoalEntryResponse {
  return {
    id: entry.id,
    kind: entry.kind,
    amount: formatMinorUnitsString(entry.amount),
    createdAt: entry.createdAt.toISOString(),
  };
}

export function presentRecordedEntry(recorded: {
  entry: GoalEntry;
  goal: GoalView;
}): RecordGoalEntryResponse {
  return { entry: presentGoalEntry(recorded.entry), goal: presentGoal(recorded.goal) };
}

export function presentGoalEntries(entries: readonly GoalEntry[]): ListGoalEntriesResponse {
  return { entries: entries.map(presentGoalEntry) };
}
