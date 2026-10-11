import { todayInTimeZone } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { Goal } from '../domain/goal';
import {
  goalStatus,
  monthlyAmountNeeded,
  percentageOf,
  type GoalStatus,
} from '../domain/goal-progress';
import type { AccountBalances } from './ports/account-balances';
import type { Clock } from './ports/clock';
import type { GoalRepository } from './ports/goal-repository';
import type { UserTimeZone } from './ports/user-time-zone';

export interface GoalDependencies {
  goals: GoalRepository;
  accounts: AccountBalances;
  timeZones: UserTimeZone;
  clock: Clock;
}

/**
 * A goal with its derived fields. `percentage` is an integer that is not money (it is not capped
 * at 100), kept as a bigint so a huge over-funded goal stays exact; the presenter converts it.
 */
export interface GoalView extends Goal {
  progress: bigint;
  percentage: bigint;
  status: GoalStatus;
  monthlyAmountNeeded: bigint | null;
}

export function buildGoalView(goal: Goal, progress: bigint, today: string): GoalView {
  return {
    ...goal,
    progress,
    percentage: percentageOf(goal.targetAmount, progress),
    status: goalStatus(goal.targetAmount, progress, goal.targetDate, today),
    monthlyAmountNeeded: monthlyAmountNeeded(goal.targetAmount, progress, goal.targetDate, today),
  };
}

/** The caller's calendar date in their stored time zone (PRD 01 FR-24). */
export async function todayFor(
  deps: Pick<GoalDependencies, 'timeZones' | 'clock'>,
  userId: string,
): Promise<string> {
  return todayInTimeZone(deps.clock.now(), await deps.timeZones.timeZoneOf(userId));
}

/**
 * Views for goals of one scope: entries sums for the unlinked ones and account balances for the
 * linked ones, each read once for the whole list (NFR-02).
 */
export async function viewsOf(
  deps: GoalDependencies,
  scope: AccessScope,
  goals: readonly Goal[],
): Promise<GoalView[]> {
  if (goals.length === 0) return [];
  const unlinked = goals.filter((goal) => goal.accountId === null).map((goal) => goal.id);
  const accountIds = [
    ...new Set(goals.flatMap((goal) => (goal.accountId === null ? [] : [goal.accountId]))),
  ];
  const [entrySums, balances, today] = await Promise.all([
    unlinked.length === 0 ? new Map<string, bigint>() : deps.goals.progressOf(scope, unlinked),
    accountIds.length === 0
      ? new Map<string, bigint>()
      : deps.accounts.balancesOf(scope, accountIds),
    todayFor(deps, scope.userId),
  ]);
  return goals.map((goal) => {
    const progress =
      goal.accountId === null
        ? (entrySums.get(goal.id) ?? 0n)
        : (balances.get(goal.accountId) ?? 0n);
    return buildGoalView(goal, progress, today);
  });
}

export async function viewOf(
  deps: GoalDependencies,
  scope: AccessScope,
  goal: Goal,
): Promise<GoalView> {
  const [view] = await viewsOf(deps, scope, [goal]);
  if (view === undefined) throw new Error('a view was expected for the goal');
  return view;
}
