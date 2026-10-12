import type { GoalResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '../src/lib/api-client';
import { canLoadMore, nextEntriesLimit } from '../src/features/goals/helpers/entries-paging';
import { goalFailureKey } from '../src/features/goals/helpers/goal-failure';
import {
  buildCreateGoal,
  buildEntry,
  buildUpdateGoal,
  type GoalFormState,
} from '../src/features/goals/helpers/goal-request';
import { toGoalView } from '../src/features/goals/helpers/goal-view';

function goal(overrides: Partial<GoalResponse> = {}): GoalResponse {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Trip',
    targetAmount: '100000',
    currency: 'ARS',
    targetDate: null,
    accountId: null,
    progress: '25000',
    percentage: 25,
    status: 'active',
    monthlyAmountNeeded: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<GoalFormState> = {}): GoalFormState {
  return {
    name: 'Trip',
    targetAmount: '1.000,00',
    currency: 'ARS',
    targetDate: '',
    accountId: '',
    ...overrides,
  };
}

function failure(code: ApiFailure['code'], messageKey: ApiFailure['messageKey']): ApiFailure {
  return { ok: false, code, messageKey };
}

describe('toGoalView', () => {
  it('gives reached, overdue, active with monthly and active', () => {
    expect(toGoalView(goal({ status: 'reached', percentage: 100 })).state).toBe('reached');
    expect(toGoalView(goal({ status: 'overdue' })).state).toBe('overdue');
    expect(toGoalView(goal({ targetDate: '2027-01-01', monthlyAmountNeeded: '5000' })).state).toBe(
      'active-with-monthly',
    );
    expect(toGoalView(goal()).state).toBe('active');
  });

  it('gives an empty bar and the negative amount for a negative progress', () => {
    const view = toGoalView(goal({ progress: '-5000', percentage: -5 }));
    expect(view.barWidth).toBe(0);
    expect(view.progress).toBe(-5000n);
    expect(view.percentage).toBe(-5);
  });

  it('clamps the bar width to 100 and keeps the percentage as received', () => {
    const view = toGoalView(goal({ progress: '150000', percentage: 150, status: 'reached' }));
    expect(view.barWidth).toBe(100);
    expect(view.percentage).toBe(150);
  });

  it('returns the monthly amount as the API string parsed to bigint', () => {
    const view = toGoalView(goal({ targetDate: '2027-01-01', monthlyAmountNeeded: '12345' }));
    expect(view.monthlyAmountNeeded).toBe(12345n);
    expect(view.targetAmount).toBe(100000n);
    expect(toGoalView(goal()).monthlyAmountNeeded).toBeNull();
  });
});

describe('entries paging', () => {
  it('canLoadMore is false when fewer came back than asked or 100 are shown', () => {
    expect(canLoadMore(49, 50)).toBe(false);
    expect(canLoadMore(100, 100)).toBe(false);
    expect(canLoadMore(100, 50)).toBe(false);
    expect(canLoadMore(50, 50)).toBe(true);
  });

  it('nextEntriesLimit goes from 50 to 100 and stops at 100', () => {
    expect(nextEntriesLimit(50)).toBe(100);
    expect(nextEntriesLimit(100)).toBe(100);
  });
});

describe('buildCreateGoal', () => {
  it('builds the body from valid state', () => {
    const result = buildCreateGoal(
      state({
        name: '  Trip  ',
        targetDate: '2027-03-01',
        accountId: '00000000-0000-4000-8000-0000000000aa',
      }),
      'es',
    );
    expect(result.request).toEqual({
      name: 'Trip',
      targetAmount: '100000',
      currency: 'ARS',
      targetDate: '2027-03-01',
      accountId: '00000000-0000-4000-8000-0000000000aa',
    });
  });

  it('omits an empty date and link', () => {
    expect(buildCreateGoal(state(), 'es').request).toEqual({
      name: 'Trip',
      targetAmount: '100000',
      currency: 'ARS',
    });
  });

  it.each([
    ['empty name', { name: '   ' }, 'name'],
    ['81-character name', { name: 'a'.repeat(81) }, 'name'],
    ['empty amount', { targetAmount: '' }, 'targetAmount'],
    ['zero amount', { targetAmount: '0' }, 'targetAmount'],
    ['non-numeric amount', { targetAmount: 'abc' }, 'targetAmount'],
    ['invalid date', { targetDate: '2027-02-31' }, 'targetDate'],
  ] as const)('rejects %s with no body', (_label, override, field) => {
    const result = buildCreateGoal(state(override), 'es');
    expect(result.request).toBeUndefined();
    expect(result.errors?.[field]).toMatch(/^goals\.form\.errors\./);
  });
});

describe('buildUpdateGoal', () => {
  const original = goal({ targetDate: '2027-01-01' });

  it('sends only changed values', () => {
    const result = buildUpdateGoal(
      state({ name: 'Trip 2', targetAmount: '1.000,00', targetDate: '2027-01-01' }),
      original,
      'es',
    );
    expect(result.request).toEqual({ name: 'Trip 2' });
  });

  it('sends a null date when it was cleared', () => {
    const result = buildUpdateGoal(state({ targetDate: '' }), original, 'es');
    expect(result.request).toEqual({ targetDate: null });
  });

  it('sends a changed amount as minor units', () => {
    const result = buildUpdateGoal(
      state({ targetAmount: '2.000,50', targetDate: '2027-01-01' }),
      original,
      'es',
    );
    expect(result.request).toEqual({ targetAmount: '200050' });
  });

  it('reports nothing to save when nothing changed', () => {
    const result = buildUpdateGoal(state({ targetDate: '2027-01-01' }), original, 'es');
    expect(result.request).toBeUndefined();
    expect(result.errors).toBeUndefined();
    expect(result.unchanged).toBe(true);
  });

  it('rejects an empty name or a zero amount', () => {
    const empty = buildUpdateGoal(state({ name: '' }), original, 'es');
    expect(empty.request).toBeUndefined();
    expect(empty.errors?.name).toMatch(/^goals\.form\.errors\./);
    const zero = buildUpdateGoal(state({ targetAmount: '0' }), original, 'es');
    expect(zero.request).toBeUndefined();
    expect(zero.errors?.targetAmount).toMatch(/^goals\.form\.errors\./);
  });
});

describe('buildEntry', () => {
  it('builds the entry body', () => {
    expect(buildEntry('contribution', '200,00', 'es').request).toEqual({
      kind: 'contribution',
      amount: '20000',
    });
    expect(buildEntry('withdrawal', '1.5', 'en').request).toEqual({
      kind: 'withdrawal',
      amount: '150',
    });
  });

  it.each(['', '0', 'abc', '-5'])('rejects %j', (text) => {
    const result = buildEntry('contribution', text, 'es');
    expect(result.request).toBeUndefined();
    expect(result.error).toBe('goals.entries.errors.amountInvalid');
  });
});

describe('goalFailureKey', () => {
  it('maps refusals to their catalog key', () => {
    expect(
      goalFailureKey(failure('GOAL_WITHDRAWAL_EXCEEDS_PROGRESS', 'goalWithdrawalExceedsProgress')),
    ).toEqual({ kind: 'message', key: 'errors.goalWithdrawalExceedsProgress' });
    expect(goalFailureKey(failure('GOAL_LIMIT_REACHED', 'goalLimitReached'))).toEqual({
      kind: 'message',
      key: 'errors.goalLimitReached',
    });
    expect(goalFailureKey(failure('GOAL_PROGRESS_TOO_LARGE', 'goalProgressTooLarge'))).toEqual({
      kind: 'message',
      key: 'errors.goalProgressTooLarge',
    });
  });

  it('maps the network failure to offline and a 404 to not found', () => {
    expect(goalFailureKey(failure('NETWORK', 'network'))).toEqual({
      kind: 'offline',
      key: 'errors.network',
    });
    expect(goalFailureKey(failure('NOT_FOUND', 'unexpected'))).toEqual({ kind: 'not-found' });
  });
});
