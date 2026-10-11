import { MOVEMENT_AMOUNT_MAX_MINOR_UNITS } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { MAX_GOAL_PROGRESS, assertGoalAmount } from '../../src/goals/domain/goal';
import {
  goalStatus,
  monthlyAmountNeeded,
  monthsLeft,
  percentageOf,
} from '../../src/goals/domain/goal-progress';

describe('goal amount cap', () => {
  it('is the largest amount a movement may carry, the same bound the repository enforces', () => {
    expect(MAX_GOAL_PROGRESS).toBe(MOVEMENT_AMOUNT_MAX_MINOR_UNITS);
    expect(() => {
      assertGoalAmount(MOVEMENT_AMOUNT_MAX_MINOR_UNITS, 'body.amount');
    }).not.toThrow();
    expect(() => {
      assertGoalAmount(MOVEMENT_AMOUNT_MAX_MINOR_UNITS + 1n, 'body.amount');
    }).toThrow();
  });
});

describe('percentageOf', () => {
  it('is the integer floor of progress over target (AC-09)', () => {
    expect(percentageOf(200000n, 50000n)).toBe(25n);
    expect(percentageOf(100000n, 33333n)).toBe(33n);
    expect(percentageOf(100000n, 99999n)).toBe(99n);
  });

  it('is 0 for zero or negative progress (AC-21)', () => {
    expect(percentageOf(200000n, 0n)).toBe(0n);
    expect(percentageOf(200000n, -5000n)).toBe(0n);
  });

  it('is not capped at 100', () => {
    expect(percentageOf(100000n, 120000n)).toBe(120n);
  });

  it('stays exact at the largest amounts', () => {
    expect(percentageOf(1n, 9_999_999_999_999_999n)).toBe(999_999_999_999_999_900n);
  });
});

describe('goalStatus', () => {
  it('is reached when progress is at or above the target (AC-12)', () => {
    expect(goalStatus(1000n, 1000n, '2026-12-31', '2026-10-15')).toBe('reached');
    expect(goalStatus(1000n, 1500n, null, '2026-10-15')).toBe('reached');
  });

  it('is overdue when the date passed and the goal is not reached (AC-11)', () => {
    expect(goalStatus(1000n, 10n, '2026-10-14', '2026-10-15')).toBe('overdue');
  });

  it('is not overdue on the target date itself', () => {
    expect(goalStatus(1000n, 10n, '2026-10-15', '2026-10-15')).toBe('active');
  });

  it('is active with no date or a future date', () => {
    expect(goalStatus(1000n, 10n, null, '2026-10-15')).toBe('active');
    expect(goalStatus(1000n, 10n, '2026-12-31', '2026-10-15')).toBe('active');
  });

  it('prefers reached over overdue', () => {
    expect(goalStatus(1000n, 1000n, '2020-01-01', '2026-10-15')).toBe('reached');
  });
});

describe('monthsLeft', () => {
  it('counts the current month and the target month', () => {
    expect(monthsLeft('2026-12-31', '2026-10-15')).toBe(3);
    expect(monthsLeft('2026-10-31', '2026-10-15')).toBe(1);
    expect(monthsLeft('2027-02-01', '2026-11-30')).toBe(4);
  });
});

describe('monthlyAmountNeeded', () => {
  it('divides the remaining amount over the months (AC-10)', () => {
    expect(monthlyAmountNeeded(200000n, 50000n, '2026-12-31', '2026-10-15')).toBe(50000n);
  });

  it('rounds up to the minor unit (AC-25)', () => {
    expect(monthlyAmountNeeded(100000n, 0n, '2026-12-31', '2026-10-15')).toBe(33334n);
  });

  it('does not round up an exact division', () => {
    expect(monthlyAmountNeeded(100000n, 1n, '2026-12-31', '2026-10-15')).toBe(33333n);
    expect(monthlyAmountNeeded(100001n, 1n, '2026-12-31', '2026-10-15')).toBe(33334n);
  });

  it('counts October when it is still October in the user zone (AC-26)', () => {
    expect(monthlyAmountNeeded(200000n, 50000n, '2026-12-31', '2026-10-31')).toBe(50000n);
  });

  it('is null when reached, overdue or without a date', () => {
    expect(monthlyAmountNeeded(1000n, 1000n, '2026-12-31', '2026-10-15')).toBeNull();
    expect(monthlyAmountNeeded(1000n, 10n, '2026-10-01', '2026-10-15')).toBeNull();
    expect(monthlyAmountNeeded(1000n, 10n, null, '2026-10-15')).toBeNull();
  });

  it('treats a negative progress as the full remaining distance', () => {
    expect(monthlyAmountNeeded(3000n, -3000n, '2026-12-31', '2026-10-15')).toBe(2000n);
  });
});
