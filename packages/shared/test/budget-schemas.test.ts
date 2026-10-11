import { describe, expect, it } from 'vitest';
import * as shared from '@pesly/shared';
import {
  budgetCurrencySchema,
  budgetIdParamsSchema,
  budgetListResponseSchema,
  budgetNameSchema,
  budgetResponseSchema,
  budgetThresholdsSchema,
  createBudgetRequestSchema,
  ERROR_CODES,
  updateBudgetRequestSchema,
} from '@pesly/shared';

const UUID_A = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';
const UUID_B = '1c1a7a1f-9d2e-4d9f-8b64-4e2a3b0d6c22';

const valid = {
  name: 'Outings',
  amount: '15000000',
  currency: 'ARS',
  categoryIds: [UUID_A, UUID_B],
};

function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  );
}

describe('budgetNameSchema (AC-02)', () => {
  it('accepts 50 characters and rejects 51, empty and whitespace-only', () => {
    expect(budgetNameSchema.safeParse('a'.repeat(50)).success).toBe(true);
    expect(budgetNameSchema.safeParse('a'.repeat(51)).success).toBe(false);
    expect(budgetNameSchema.safeParse('').success).toBe(false);
    expect(budgetNameSchema.safeParse('   ').success).toBe(false);
  });

  it('trims, normalizes to NFC and refuses control characters', () => {
    expect(budgetNameSchema.parse('  Café  ')).toBe('Café');
    expect(budgetNameSchema.safeParse('a\u0000b').success).toBe(false);
  });
});

describe('createBudgetRequestSchema', () => {
  it('accepts a valid body and the amount 15000000 as a string (AC-21)', () => {
    const parsed = createBudgetRequestSchema.parse(valid);
    expect(parsed.amount).toBe('15000000');
    expect(parsed.rollover).toBeUndefined();
    expect(parsed.thresholds).toBeUndefined();
  });

  it.each(['0', '-5', '1.5', 'abc', '', '007'])('rejects the amount %j (AC-02)', (amount) => {
    expect(createBudgetRequestSchema.safeParse({ ...valid, amount }).success).toBe(false);
  });

  it('rejects a number-typed amount', () => {
    expect(createBudgetRequestSchema.safeParse({ ...valid, amount: 15000000 }).success).toBe(false);
  });

  it('rejects a currency other than ARS or USD and accepts both (AC-02)', () => {
    expect(budgetCurrencySchema.safeParse('EUR').success).toBe(false);
    expect(budgetCurrencySchema.safeParse('ARS').success).toBe(true);
    expect(budgetCurrencySchema.safeParse('USD').success).toBe(true);
    expect(createBudgetRequestSchema.safeParse({ ...valid, currency: 'EUR' }).success).toBe(false);
  });

  it('rejects an empty or repeated categoryIds and a non-uuid (AC-02)', () => {
    expect(createBudgetRequestSchema.safeParse({ ...valid, categoryIds: [] }).success).toBe(false);
    expect(
      createBudgetRequestSchema.safeParse({ ...valid, categoryIds: [UUID_A, UUID_A] }).success,
    ).toBe(false);
    expect(createBudgetRequestSchema.safeParse({ ...valid, categoryIds: ['x'] }).success).toBe(
      false,
    );
  });

  it('accepts 50 categories and rejects 51', () => {
    expect(createBudgetRequestSchema.safeParse({ ...valid, categoryIds: ids(50) }).success).toBe(
      true,
    );
    expect(createBudgetRequestSchema.safeParse({ ...valid, categoryIds: ids(51) }).success).toBe(
      false,
    );
  });

  it('rejects an unknown key and a wrong-typed rollover', () => {
    expect(createBudgetRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(createBudgetRequestSchema.safeParse({ ...valid, rollover: 'yes' }).success).toBe(false);
    expect(createBudgetRequestSchema.safeParse({ ...valid, rollover: true }).success).toBe(true);
  });

  it('reports the failing path of an invalid field', () => {
    const result = createBudgetRequestSchema.safeParse({ ...valid, amount: '0' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('amount');
  });
});

describe('budgetThresholdsSchema (AC-11, AC-22)', () => {
  it.each([[[0]], [[201]], [[1.5]], [[50, 50]], [[]], [[10, 20, 30, 40, 50, 60]]])(
    'rejects %j',
    (value) => {
      expect(budgetThresholdsSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([[[1]], [[200]], [[10, 20, 30, 40, 50]], [[120, 50, 80]]])('accepts %j', (value) => {
    expect(budgetThresholdsSchema.safeParse(value).success).toBe(true);
  });

  it('is enforced inside the create body', () => {
    expect(createBudgetRequestSchema.safeParse({ ...valid, thresholds: [0] }).success).toBe(false);
    expect(createBudgetRequestSchema.safeParse({ ...valid, thresholds: [80, 100] }).success).toBe(
      true,
    );
  });
});

describe('updateBudgetRequestSchema (AC-15)', () => {
  it('rejects an empty body', () => {
    expect(updateBudgetRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects currency as an unknown key', () => {
    expect(updateBudgetRequestSchema.safeParse({ currency: 'USD' }).success).toBe(false);
    expect(updateBudgetRequestSchema.safeParse({ name: 'x', currency: 'USD' }).success).toBe(false);
  });

  it('accepts a partial body of any one key', () => {
    expect(updateBudgetRequestSchema.safeParse({ name: 'New' }).success).toBe(true);
    expect(updateBudgetRequestSchema.safeParse({ amount: '1' }).success).toBe(true);
    expect(updateBudgetRequestSchema.safeParse({ rollover: false }).success).toBe(true);
    expect(updateBudgetRequestSchema.safeParse({ thresholds: [50] }).success).toBe(true);
    expect(updateBudgetRequestSchema.safeParse({ categoryIds: [UUID_A] }).success).toBe(true);
  });

  it('applies the same value rules as create', () => {
    expect(updateBudgetRequestSchema.safeParse({ amount: '0' }).success).toBe(false);
    expect(updateBudgetRequestSchema.safeParse({ categoryIds: [] }).success).toBe(false);
    expect(updateBudgetRequestSchema.safeParse({ thresholds: [] }).success).toBe(false);
    expect(updateBudgetRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('params and responses', () => {
  const response = {
    id: UUID_A,
    name: 'Outings',
    amount: '15000000',
    currency: 'ARS',
    rollover: false,
    thresholds: [80, 100],
    categoryIds: [UUID_B],
    coveredCategoryIds: [UUID_B, UUID_A],
    effectiveFrom: '2026-10-01',
    createdAt: '2026-10-11T12:00:00.000Z',
  };

  it('requires a uuid id', () => {
    expect(budgetIdParamsSchema.safeParse({ id: UUID_A }).success).toBe(true);
    expect(budgetIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });

  it('parses a response and a list of responses', () => {
    expect(budgetResponseSchema.safeParse(response).success).toBe(true);
    expect(budgetListResponseSchema.safeParse([response]).success).toBe(true);
  });

  it('rejects a non-string amount and a bad effectiveFrom', () => {
    expect(budgetResponseSchema.safeParse({ ...response, amount: 15000000 }).success).toBe(false);
    expect(budgetResponseSchema.safeParse({ ...response, effectiveFrom: 'October' }).success).toBe(
      false,
    );
  });
});

describe('error codes and exports', () => {
  it('declares the two budget codes', () => {
    expect(ERROR_CODES).toContain('BUDGET_LIMIT_REACHED');
    expect(ERROR_CODES).toContain('BUDGET_CATEGORY_KIND_INVALID');
  });

  it('re-exports the budget contract from the package index', () => {
    expect(shared.createBudgetRequestSchema).toBe(createBudgetRequestSchema);
    expect(shared.BUDGET_DEFAULT_THRESHOLDS).toEqual([80, 100]);
    expect(shared.BUDGET_LIMIT_PER_USER).toBe(50);
  });
});
