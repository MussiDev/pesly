import { describe, expect, it } from 'vitest';
import {
  createInstallmentPurchaseRequestSchema,
  installmentExpensesQuerySchema,
  installmentPurchaseResponseSchema,
  updateInstallmentPurchaseRequestSchema,
} from '../src/credit-cards/installment';
import { splitInstallments } from '../src/money/split-installments';

const UUID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const VALID = {
  currency: 'ARS',
  categoryId: UUID,
  amount: '12000000',
  installments: 12,
  purchasedOn: '2026-10-07',
};

describe('splitInstallments', () => {
  it('splits 100.00 ARS in 3 into 3334, 3333 and 3333 minor units (AC-04)', () => {
    expect(splitInstallments(10000n, 3)).toEqual([3334n, 3333n, 3333n]);
  });

  it('gives 12 equal parts for 120,000.00 ARS in 12 (AC-01)', () => {
    const parts = splitInstallments(12000000n, 12);
    expect(parts).toHaveLength(12);
    expect(new Set(parts)).toEqual(new Set([1000000n]));
  });

  it('gives every leftover minor unit to the first installment', () => {
    expect(splitInstallments(107n, 5)).toEqual([23n, 21n, 21n, 21n, 21n]);
  });

  it('adds up exactly over 10,000 random purchases with the first part the largest (NFR-03)', () => {
    // Deterministic generator: the test must not depend on Math.random.
    let state = 123456789n;
    const next = (bound: bigint): bigint => {
      state = (state * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
      return state % bound;
    };
    for (let i = 0; i < 10_000; i += 1) {
      const count = 2 + Number(next(59n));
      const total = BigInt(count) + next(10n ** 15n - BigInt(count));
      const parts = splitInstallments(total, count);
      expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(total);
      expect(parts[0]).toBeGreaterThanOrEqual(parts[1] ?? 0n);
      expect(parts.every((part) => part >= 1n)).toBe(true);
    }
  });

  it.each([1, 61, 0, 2.5])('throws a RangeError for %s installments (error path)', (count) => {
    expect(() => splitInstallments(100000n, count)).toThrow(RangeError);
  });

  it('throws a RangeError when the total is smaller than the count (error path)', () => {
    expect(() => splitInstallments(2n, 3)).toThrow(RangeError);
  });
});

describe('createInstallmentPurchaseRequestSchema', () => {
  it('accepts 120,000.00 ARS in 12 installments (AC-01)', () => {
    expect(createInstallmentPurchaseRequestSchema.parse(VALID)).toEqual(VALID);
  });

  it.each([1, 61, 0, -2, 2.5])('rejects %s installments (AC-02)', (installments) => {
    expect(
      createInstallmentPurchaseRequestSchema.safeParse({ ...VALID, installments }).success,
    ).toBe(false);
  });

  it('accepts ARS and USD', () => {
    for (const currency of ['ARS', 'USD']) {
      expect(createInstallmentPurchaseRequestSchema.safeParse({ ...VALID, currency }).success).toBe(
        true,
      );
    }
  });

  it.each(['USDT', 'EUR', 'ars', undefined])('rejects the currency %s (AC-03)', (currency) => {
    expect(createInstallmentPurchaseRequestSchema.safeParse({ ...VALID, currency }).success).toBe(
      false,
    );
  });

  it.each(['0', '15.99', '015', '5'])('rejects the amount %s as invalid input', (amount) => {
    expect(createInstallmentPurchaseRequestSchema.safeParse({ ...VALID, amount }).success).toBe(
      false,
    );
  });

  it('rejects an unknown key and a zero-width character in the note', () => {
    expect(
      createInstallmentPurchaseRequestSchema.safeParse({ ...VALID, accountId: UUID }).success,
    ).toBe(false);
    expect(
      createInstallmentPurchaseRequestSchema.safeParse({ ...VALID, note: 'a​b' }).success,
    ).toBe(false);
  });

  it('rejects a date that does not exist', () => {
    expect(
      createInstallmentPurchaseRequestSchema.safeParse({ ...VALID, purchasedOn: '2027-02-29' })
        .success,
    ).toBe(false);
  });

  it('reports only the failing paths, not the typed values', () => {
    const result = createInstallmentPurchaseRequestSchema.safeParse({
      ...VALID,
      installments: 99,
      note: 'secret​',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(paths).toContain('installments');
    expect(JSON.stringify(paths)).not.toContain('secret');
  });
});

describe('updateInstallmentPurchaseRequestSchema', () => {
  it('accepts a category, a note, or a null note that clears it', () => {
    expect(updateInstallmentPurchaseRequestSchema.parse({ categoryId: UUID })).toEqual({
      categoryId: UUID,
    });
    expect(updateInstallmentPurchaseRequestSchema.parse({ note: null })).toEqual({ note: null });
    expect(updateInstallmentPurchaseRequestSchema.parse({ note: '  ' })).toEqual({ note: null });
  });

  it('rejects an empty body and an amount key', () => {
    expect(updateInstallmentPurchaseRequestSchema.safeParse({}).success).toBe(false);
    expect(updateInstallmentPurchaseRequestSchema.safeParse({ amount: '1000' }).success).toBe(
      false,
    );
  });
});

describe('installmentExpensesQuerySchema', () => {
  it('accepts a range and a single month', () => {
    expect(
      installmentExpensesQuerySchema.safeParse({ from: '2026-11', to: '2026-11' }).success,
    ).toBe(true);
  });

  it('rejects an inverted range, a range over 60 months and a malformed month', () => {
    expect(
      installmentExpensesQuerySchema.safeParse({ from: '2026-12', to: '2026-11' }).success,
    ).toBe(false);
    expect(
      installmentExpensesQuerySchema.safeParse({ from: '2020-01', to: '2025-01' }).success,
    ).toBe(false);
    expect(
      installmentExpensesQuerySchema.safeParse({ from: '2026-13', to: '2026-14' }).success,
    ).toBe(false);
  });
});

describe('installmentPurchaseResponseSchema', () => {
  it('parses a purchase with its installments', () => {
    expect(
      installmentPurchaseResponseSchema.safeParse({
        id: UUID,
        cardId: UUID,
        categoryId: UUID,
        amount: '12000000',
        currency: 'ARS',
        installmentCount: 2,
        purchasedOn: '2026-10-07',
        note: null,
        createdAt: '2026-10-07T12:00:00.000Z',
        installments: [
          {
            number: 1,
            amount: '6000000',
            period: '2026-10',
            closingDate: '2026-10-24',
            dueDate: '2026-11-05',
            status: 'open',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
