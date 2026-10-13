import { describe, expect, it } from 'vitest';
import * as shared from '@pesly/shared';
import {
  budgetSpendingListResponseSchema,
  budgetSpendingMonthSchema,
  budgetSpendingQuerySchema,
  budgetSpendingResponseSchema,
  ERROR_CODES,
} from '@pesly/shared';

const UUID = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';

const response = {
  budgetId: UUID,
  name: 'Outings',
  currency: 'ARS',
  month: '2026-10',
  amount: '15000000',
  rolloverEnabled: true,
  rolloverAmount: '2000000',
  available: '17000000',
  spent: '12000000',
  remaining: '5000000',
  percentUsed: 70,
  thresholds: [80, 100],
  unconvertedShareCount: 0,
  unconvertedInstallmentCount: 0,
};

describe('budgetSpendingQuerySchema (AC-15, AC-16)', () => {
  it('accepts 2026-10, 2026-01 and the first supported month 1971-01', () => {
    expect(budgetSpendingMonthSchema.safeParse('1971-01').success).toBe(true);
    expect(budgetSpendingQuerySchema.safeParse({ month: '2026-10' }).success).toBe(true);
    expect(budgetSpendingQuerySchema.safeParse({ month: '2026-01' }).success).toBe(true);
    expect(budgetSpendingMonthSchema.safeParse('2026-12').success).toBe(true);
  });

  it.each(['0000-01', '1970-12', '2026-13', '2026-00', '2026-1', '2026-10-01', '', 202610])(
    'rejects the month %j',
    (month) => {
      expect(budgetSpendingQuerySchema.safeParse({ month }).success).toBe(false);
    },
  );

  it('accepts an absent month and rejects an unknown key', () => {
    expect(budgetSpendingQuerySchema.safeParse({}).success).toBe(true);
    expect(budgetSpendingQuerySchema.safeParse({ month: '2026-10', extra: '1' }).success).toBe(
      false,
    );
  });
});

describe('budgetSpendingResponseSchema (AC-14, AC-28)', () => {
  it('parses a valid response and a negative remaining', () => {
    expect(budgetSpendingResponseSchema.safeParse(response).success).toBe(true);
    expect(
      budgetSpendingResponseSchema.safeParse({ ...response, remaining: '-3000000' }).success,
    ).toBe(true);
  });

  it.each([1001, -1, 80.5])('rejects percentUsed %s', (percentUsed) => {
    expect(budgetSpendingResponseSchema.safeParse({ ...response, percentUsed }).success).toBe(
      false,
    );
  });

  it('accepts the bounds 0 and 1000 of percentUsed', () => {
    expect(budgetSpendingResponseSchema.safeParse({ ...response, percentUsed: 0 }).success).toBe(
      true,
    );
    expect(budgetSpendingResponseSchema.safeParse({ ...response, percentUsed: 1000 }).success).toBe(
      true,
    );
  });

  it.each(['amount', 'rolloverAmount', 'available', 'spent', 'remaining'])(
    'rejects a decimal, exponent or numeric %s',
    (field) => {
      for (const bad of ['1.5', '1e3', 1500]) {
        expect(budgetSpendingResponseSchema.safeParse({ ...response, [field]: bad }).success).toBe(
          false,
        );
      }
    },
  );

  it('rejects a negative unconvertedShareCount and a bad month', () => {
    expect(
      budgetSpendingResponseSchema.safeParse({ ...response, unconvertedShareCount: -1 }).success,
    ).toBe(false);
    expect(budgetSpendingResponseSchema.safeParse({ ...response, month: '2026-13' }).success).toBe(
      false,
    );
  });

  it('requires a non-negative integer unconvertedInstallmentCount (AC-27)', () => {
    const without: Partial<typeof response> = { ...response };
    delete without.unconvertedInstallmentCount;
    expect(budgetSpendingResponseSchema.safeParse(without).success).toBe(false);
    for (const bad of [-1, 1.5, '2']) {
      expect(
        budgetSpendingResponseSchema.safeParse({ ...response, unconvertedInstallmentCount: bad })
          .success,
      ).toBe(false);
    }
    expect(
      budgetSpendingResponseSchema.parse({ ...response, unconvertedInstallmentCount: 3 })
        .unconvertedInstallmentCount,
    ).toBe(3);
  });

  it('parses the list envelope', () => {
    expect(
      budgetSpendingListResponseSchema.safeParse({ month: '2026-10', budgets: [response] }).success,
    ).toBe(true);
    expect(
      budgetSpendingListResponseSchema.safeParse({ month: '2026-10', budgets: [{}] }).success,
    ).toBe(false);
  });
});

describe('error code and exports', () => {
  it('declares BUDGET_MONTH_IN_FUTURE', () => {
    expect(ERROR_CODES).toContain('BUDGET_MONTH_IN_FUTURE');
  });

  it('re-exports the contract from the package index', () => {
    expect(shared.budgetSpendingQuerySchema).toBe(budgetSpendingQuerySchema);
  });
});
