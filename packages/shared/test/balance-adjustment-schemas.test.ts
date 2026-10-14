import { describe, expect, it } from 'vitest';
import {
  CREATABLE_MOVEMENT_TYPES,
  MOVEMENT_TYPES,
  OPENING_BALANCE_LIMIT_MINOR_UNITS,
  createMovementRequestSchema,
  listMovementsQuerySchema,
  movementFilterShape,
  movementResponseSchema,
  setAccountBalanceRequestSchema,
  setAccountBalanceResponseSchema,
  signedMovementAmountSchema,
  updateMovementRequestSchema,
} from '../src';

const ACCOUNT_ID = '0b9d1f6e-5a3c-4c8e-9a43-2f1d7a6b8c90';
const LIMIT = OPENING_BALANCE_LIMIT_MINOR_UNITS;

describe('movement types', () => {
  it('adds adjustment to the stored types but not to the creatable ones', () => {
    expect(MOVEMENT_TYPES).toEqual(['expense', 'income', 'transfer', 'exchange', 'adjustment']);
    expect(CREATABLE_MOVEMENT_TYPES).toEqual(['expense', 'income', 'transfer', 'exchange']);
  });

  it('creation and update schemas reject type adjustment (AC-08)', () => {
    const body = {
      type: 'adjustment',
      accountId: ACCOUNT_ID,
      amount: '500',
      occurredAt: '2026-10-02T15:30:00Z',
    };
    expect(createMovementRequestSchema.safeParse(body).success).toBe(false);
    expect(updateMovementRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('signedMovementAmountSchema', () => {
  it('accepts a signed non-zero integer within the limit (AC-12)', () => {
    for (const value of ['-500', '500', '1', '-1', LIMIT.toString(), (-LIMIT).toString()]) {
      expect(signedMovementAmountSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it('rejects zero, decimals, exponents, leading zeros and values above the limit (AC-12)', () => {
    const rejected = [
      '0',
      '-0',
      '1.5',
      '1e3',
      '',
      ' 5',
      '007',
      '+5',
      (LIMIT + 1n).toString(),
      (-LIMIT - 1n).toString(),
    ];
    for (const value of rejected) {
      expect(signedMovementAmountSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('is what a movement response uses for amount, so an adjustment can be negative', () => {
    const response = {
      id: 'a',
      type: 'adjustment',
      accountId: ACCOUNT_ID,
      categoryId: null,
      destinationAccountId: null,
      amount: '-500',
      destinationAmount: null,
      occurredAt: '2026-10-02T15:30:00.000Z',
      note: null,
      rate: null,
      rateSource: null,
      rateType: null,
      createdAt: '2026-10-02T15:30:00.000Z',
      tags: [],
    };
    expect(movementResponseSchema.safeParse(response).success).toBe(true);
    expect(movementResponseSchema.safeParse({ ...response, amount: '0' }).success).toBe(false);
  });
});

describe('setAccountBalanceRequestSchema', () => {
  it('accepts a signed balance, zero included, with optional note', () => {
    for (const balance of ['0', '1000', '-1000', LIMIT.toString(), (-LIMIT).toString()]) {
      expect(setAccountBalanceRequestSchema.safeParse({ balance }).success, balance).toBe(true);
    }
    expect(setAccountBalanceRequestSchema.parse({ balance: '5', note: '  fix  ' }).note).toBe(
      'fix',
    );
  });

  it('rejects a value above the limit and a non-integer (AC-12)', () => {
    for (const balance of [
      (LIMIT + 1n).toString(),
      (-LIMIT - 1n).toString(),
      '1.5',
      '1e3',
      '',
      'abc',
    ]) {
      expect(setAccountBalanceRequestSchema.safeParse({ balance }).success, balance).toBe(false);
    }
    expect(setAccountBalanceRequestSchema.safeParse({}).success).toBe(false);
    expect(setAccountBalanceRequestSchema.safeParse({ balance: 5 }).success).toBe(false);
  });

  it('rejects a note with control characters or over 500 code points', () => {
    expect(
      setAccountBalanceRequestSchema.safeParse({ balance: '1', note: 'a\u0000b' }).success,
    ).toBe(false);
    expect(
      setAccountBalanceRequestSchema.safeParse({ balance: '1', note: 'a'.repeat(501) }).success,
    ).toBe(false);
  });

  it('accepts a TOTP or recovery code and rejects a malformed one (AC-20)', () => {
    const accepted = ['123456', ' 123456 ', 'ABCDE-12345'];
    for (const secondFactorCode of accepted) {
      const result = setAccountBalanceRequestSchema.safeParse({ balance: '1', secondFactorCode });
      expect(result.success, secondFactorCode).toBe(true);
    }
    for (const secondFactorCode of ['12345', '1234567', 'abc', '', '12 3456', 'x'.repeat(200)]) {
      const result = setAccountBalanceRequestSchema.safeParse({ balance: '1', secondFactorCode });
      expect(result.success, secondFactorCode).toBe(false);
    }
  });
});

describe('setAccountBalanceResponseSchema', () => {
  const account = {
    id: ACCOUNT_ID,
    name: 'Cash',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '0',
    balance: '1000',
    includeInAvailable: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-02T15:30:00.000Z',
  };

  it('accepts a null adjustment (target equals current)', () => {
    expect(setAccountBalanceResponseSchema.safeParse({ account, adjustment: null }).success).toBe(
      true,
    );
  });

  it('rejects a missing adjustment key', () => {
    expect(setAccountBalanceResponseSchema.safeParse({ account }).success).toBe(false);
  });
});

describe('hideAdjustments filter', () => {
  it('parses true and false and rejects other text (AC-06)', () => {
    for (const value of ['true', 'false']) {
      const result = listMovementsQuerySchema.safeParse({ hideAdjustments: value });
      expect(result.success, value).toBe(true);
    }
    expect(listMovementsQuerySchema.parse({}).hideAdjustments).toBeUndefined();
    for (const value of ['yes', '1', 'TRUE', '', 'null']) {
      expect(listMovementsQuerySchema.safeParse({ hideAdjustments: value }).success, value).toBe(
        false,
      );
    }
    expect(Object.keys(movementFilterShape)).toContain('hideAdjustments');
  });
});
