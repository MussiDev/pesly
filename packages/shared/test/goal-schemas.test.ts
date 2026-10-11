import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors';
import {
  GOAL_NAME_MAX_LENGTH,
  createGoalEntryRequestSchema,
  createGoalRequestSchema,
  goalEntryResponseSchema,
  goalIdParamsSchema,
  goalResponseSchema,
  listGoalEntriesQuerySchema,
  listGoalEntriesResponseSchema,
  listGoalsResponseSchema,
  recordGoalEntryResponseSchema,
  updateGoalRequestSchema,
} from '../src/goals/goal';

const ID = '11111111-1111-4111-8111-111111111111';
const ACC = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-11T12:00:00.000Z';

const create = { name: 'Trip', targetAmount: '500000', currency: 'ARS' };

const goal = {
  id: ID,
  name: 'Trip',
  targetAmount: '500000',
  currency: 'ARS',
  targetDate: '2027-01-31',
  accountId: null,
  progress: '1000',
  percentage: 0,
  status: 'active',
  monthlyAmountNeeded: '125000',
  createdAt: NOW,
};

describe('goal name (AC-17)', () => {
  it('accepts 80 characters and rejects 81', () => {
    expect(GOAL_NAME_MAX_LENGTH).toBe(80);
    expect(createGoalRequestSchema.safeParse({ ...create, name: 'a'.repeat(80) }).success).toBe(
      true,
    );
    expect(createGoalRequestSchema.safeParse({ ...create, name: 'a'.repeat(81) }).success).toBe(
      false,
    );
  });

  it('rejects an empty or whitespace-only name on create and on update (AC-22)', () => {
    for (const name of ['', '   ', '​']) {
      expect(createGoalRequestSchema.safeParse({ ...create, name }).success).toBe(false);
      expect(updateGoalRequestSchema.safeParse({ name }).success).toBe(false);
    }
  });

  it('trims a valid name', () => {
    expect(createGoalRequestSchema.parse({ ...create, name: '  Trip  ' }).name).toBe('Trip');
  });
});

describe('target amount (AC-02, AC-22)', () => {
  it.each(['0', '-5', '1.5', '+5', '', 'abc', '10000000000000000'])('rejects %j', (amount) => {
    expect(createGoalRequestSchema.safeParse({ ...create, targetAmount: amount }).success).toBe(
      false,
    );
    expect(updateGoalRequestSchema.safeParse({ targetAmount: amount }).success).toBe(false);
  });

  it('accepts a positive integer string', () => {
    expect(createGoalRequestSchema.safeParse(create).success).toBe(true);
  });
});

describe('create request', () => {
  it('accepts the optional date and account', () => {
    const parsed = createGoalRequestSchema.parse({
      ...create,
      currency: 'USD',
      targetDate: '2027-02-28',
      accountId: ACC,
    });
    expect(parsed.accountId).toBe(ACC);
  });

  it('rejects an unknown key such as progress (AC-13)', () => {
    expect(createGoalRequestSchema.safeParse({ ...create, progress: '5' }).success).toBe(false);
  });

  it('rejects a currency other than ARS and USD and a non-uuid account', () => {
    expect(createGoalRequestSchema.safeParse({ ...create, currency: 'EUR' }).success).toBe(false);
    expect(createGoalRequestSchema.safeParse({ ...create, accountId: 'x' }).success).toBe(false);
  });

  it('rejects a target date that is not a real calendar date (AC-01)', () => {
    for (const targetDate of ['2026-02-30', '2026-13-01', '2026-1-1', 'tomorrow']) {
      expect(createGoalRequestSchema.safeParse({ ...create, targetDate }).success).toBe(false);
    }
  });
});

describe('update request (AC-13)', () => {
  it('rejects an empty body and unknown keys', () => {
    expect(updateGoalRequestSchema.safeParse({}).success).toBe(false);
    expect(updateGoalRequestSchema.safeParse({ currency: 'USD' }).success).toBe(false);
    expect(updateGoalRequestSchema.safeParse({ accountId: ACC }).success).toBe(false);
  });

  it('accepts a null target date to remove it', () => {
    expect(updateGoalRequestSchema.parse({ targetDate: null })).toEqual({ targetDate: null });
  });

  it('rejects an impossible date', () => {
    expect(updateGoalRequestSchema.safeParse({ targetDate: '2026-02-30' }).success).toBe(false);
  });
});

describe('entry request (AC-20)', () => {
  it('accepts both kinds', () => {
    for (const kind of ['contribution', 'withdrawal']) {
      expect(createGoalEntryRequestSchema.safeParse({ kind, amount: '100' }).success).toBe(true);
    }
  });

  it.each(['0', '-1', '1.5'])('rejects amount %j', (amount) => {
    expect(createGoalEntryRequestSchema.safeParse({ kind: 'contribution', amount }).success).toBe(
      false,
    );
  });

  it('rejects an unknown kind and extra keys', () => {
    expect(createGoalEntryRequestSchema.safeParse({ kind: 'gift', amount: '1' }).success).toBe(
      false,
    );
    expect(
      createGoalEntryRequestSchema.safeParse({ kind: 'contribution', amount: '1', note: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('params and query', () => {
  it('validates the id and the limit bounds', () => {
    expect(goalIdParamsSchema.safeParse({ id: ID }).success).toBe(true);
    expect(goalIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
    expect(listGoalEntriesQuerySchema.parse({})).toEqual({});
    expect(listGoalEntriesQuerySchema.parse({ limit: '100' })).toEqual({ limit: 100 });
    for (const limit of ['0', '101', '1.5', 'x']) {
      expect(listGoalEntriesQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });
});

describe('responses', () => {
  const entry = { id: ID, kind: 'contribution', amount: '100', createdAt: NOW };

  it('parse the documented shapes', () => {
    expect(goalResponseSchema.safeParse(goal).success).toBe(true);
    expect(
      goalResponseSchema.safeParse({ ...goal, targetDate: null, monthlyAmountNeeded: null })
        .success,
    ).toBe(true);
    expect(listGoalsResponseSchema.safeParse({ goals: [goal] }).success).toBe(true);
    expect(goalEntryResponseSchema.safeParse(entry).success).toBe(true);
    expect(recordGoalEntryResponseSchema.safeParse({ entry, goal }).success).toBe(true);
    expect(listGoalEntriesResponseSchema.safeParse({ entries: [entry] }).success).toBe(true);
  });

  it('allow a negative progress string and a percentage above 100', () => {
    expect(
      goalResponseSchema.safeParse({ ...goal, progress: '-50', percentage: 120 }).success,
    ).toBe(true);
  });

  it('reject an unknown status and a fractional percentage', () => {
    expect(goalResponseSchema.safeParse({ ...goal, status: 'done' }).success).toBe(false);
    expect(goalResponseSchema.safeParse({ ...goal, percentage: 1.5 }).success).toBe(false);
  });
});

describe('error codes', () => {
  it.each([
    'GOAL_ACCOUNT_CURRENCY_MISMATCH',
    'GOAL_LINKED_TO_ACCOUNT',
    'GOAL_WITHDRAWAL_EXCEEDS_PROGRESS',
    'GOAL_PROGRESS_TOO_LARGE',
    'GOAL_LIMIT_REACHED',
    'ACCOUNT_LINKED_TO_GOAL',
  ])('%s is a shared error code', (code) => {
    expect(ERROR_CODES as readonly string[]).toContain(code);
  });
});
