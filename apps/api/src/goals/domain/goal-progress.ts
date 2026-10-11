export type GoalStatus = 'active' | 'reached' | 'overdue';

/** Integer part of progress over target, 0 for negative progress, not capped at 100 (AC-09, AC-21). */
export function percentageOf(target: bigint, progress: bigint): bigint {
  if (progress <= 0n) return 0n;
  return (progress * 100n) / target;
}

/** A goal due today is not overdue; reaching the target wins over a passed date (AC-11, AC-12). */
export function goalStatus(
  target: bigint,
  progress: bigint,
  targetDate: string | null,
  today: string,
): GoalStatus {
  if (progress >= target) return 'reached';
  if (targetDate !== null && targetDate < today) return 'overdue';
  return 'active';
}

/** Months from the current one to the target month, both included. Dates are `YYYY-MM-DD`. */
export function monthsLeft(targetDate: string, today: string): number {
  const [targetYear = 0, targetMonth = 0] = targetDate.split('-').map(Number);
  const [year = 0, month = 0] = today.split('-').map(Number);
  return (targetYear - year) * 12 + (targetMonth - month) + 1;
}

/** Remaining amount over the months left, rounded up to the minor unit (AC-10, AC-25, AC-26). */
export function monthlyAmountNeeded(
  target: bigint,
  progress: bigint,
  targetDate: string | null,
  today: string,
): bigint | null {
  if (targetDate === null) return null;
  if (goalStatus(target, progress, targetDate, today) !== 'active') return null;
  const months = BigInt(monthsLeft(targetDate, today));
  return (target - progress + months - 1n) / months;
}
