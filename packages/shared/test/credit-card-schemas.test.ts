import { describe, expect, it } from 'vitest';
import { accountNameSchema } from '../src/accounts/account';
import {
  CARD_NAME_MAX_LENGTH,
  createCreditCardRequestSchema,
  creditCardResponseSchema,
  statementParamsSchema,
  statementResponseSchema,
  updateCreditCardRequestSchema,
  updateStatementRequestSchema,
} from '../src/credit-cards/credit-card';

const UUID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

describe('createCreditCardRequestSchema', () => {
  it('accepts a name with closing and due days and trims the name (AC-01)', () => {
    expect(
      createCreditCardRequestSchema.parse({ name: '  Visa  ', closingDay: 24, dueDay: 5 }),
    ).toEqual({ name: 'Visa', closingDay: 24, dueDay: 5 });
    expect(
      createCreditCardRequestSchema.safeParse({ name: 'x', closingDay: 1, dueDay: 31 }).success,
    ).toBe(true);
  });

  it.each([0, 32, 1.5, '24', null])(
    'rejects closing or due day %s as invalid input (AC-02)',
    (day) => {
      expect(
        createCreditCardRequestSchema.safeParse({ name: 'Visa', closingDay: day, dueDay: 5 })
          .success,
      ).toBe(false);
      expect(
        createCreditCardRequestSchema.safeParse({ name: 'Visa', closingDay: 24, dueDay: day })
          .success,
      ).toBe(false);
    },
  );

  it('accepts 46 characters and rejects 47, blank and zero-width names as invalid input (FR-01)', () => {
    expect(CARD_NAME_MAX_LENGTH).toBe(46);
    const base = { closingDay: 24, dueDay: 5 };
    expect(createCreditCardRequestSchema.safeParse({ ...base, name: 'a'.repeat(46) }).success).toBe(
      true,
    );
    expect(createCreditCardRequestSchema.safeParse({ ...base, name: 'a'.repeat(47) }).success).toBe(
      false,
    );
    expect(createCreditCardRequestSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(createCreditCardRequestSchema.safeParse({ ...base, name: 'Vi\u200Bsa' }).success).toBe(
      false,
    );
  });

  it('rejects unknown keys and missing fields as invalid input', () => {
    expect(
      createCreditCardRequestSchema.safeParse({
        name: 'Visa',
        closingDay: 24,
        dueDay: 5,
        ownerId: UUID,
      }).success,
    ).toBe(false);
    expect(createCreditCardRequestSchema.safeParse({ name: 'Visa', closingDay: 24 }).success).toBe(
      false,
    );
  });
});

describe('updateCreditCardRequestSchema', () => {
  it('accepts either day alone or both (FR-06)', () => {
    expect(updateCreditCardRequestSchema.parse({ closingDay: 20 })).toEqual({ closingDay: 20 });
    expect(updateCreditCardRequestSchema.parse({ dueDay: 7 })).toEqual({ dueDay: 7 });
    expect(updateCreditCardRequestSchema.parse({ closingDay: 20, dueDay: 7 })).toEqual({
      closingDay: 20,
      dueDay: 7,
    });
  });

  it('rejects an empty body, a name and an out-of-range day as invalid input', () => {
    expect(updateCreditCardRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCreditCardRequestSchema.safeParse({ name: 'Other' }).success).toBe(false);
    expect(updateCreditCardRequestSchema.safeParse({ closingDay: 32 }).success).toBe(false);
  });
});

describe('updateStatementRequestSchema', () => {
  it('accepts either date alone or both (FR-05)', () => {
    expect(updateStatementRequestSchema.parse({ closingDate: '2026-10-26' })).toEqual({
      closingDate: '2026-10-26',
    });
    expect(
      updateStatementRequestSchema.parse({ closingDate: '2026-10-26', dueDate: '2026-11-05' }),
    ).toEqual({ closingDate: '2026-10-26', dueDate: '2026-11-05' });
  });

  it('rejects impossible dates, malformed dates and an empty body as invalid input (FR-05)', () => {
    expect(updateStatementRequestSchema.safeParse({ closingDate: '2027-02-29' }).success).toBe(
      false,
    );
    expect(updateStatementRequestSchema.safeParse({ dueDate: '2026-1-05' }).success).toBe(false);
    expect(updateStatementRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateStatementRequestSchema.safeParse({ closingDate: '2026-10-26', period: '2026-10' })
        .success,
    ).toBe(false);
  });
});

describe('params and responses', () => {
  it('requires UUIDs for card and statement ids (invalid input)', () => {
    expect(statementParamsSchema.safeParse({ id: UUID, statementId: UUID }).success).toBe(true);
    expect(statementParamsSchema.safeParse({ id: UUID, statementId: '..' }).success).toBe(false);
  });

  it('describes a card and a statement', () => {
    expect(
      creditCardResponseSchema.safeParse({
        id: UUID,
        name: 'Visa',
        closingDay: 24,
        dueDay: 5,
        arsAccountId: UUID,
        usdAccountId: UUID,
        createdAt: '2026-10-06T12:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      statementResponseSchema.safeParse({
        id: UUID,
        cardId: UUID,
        period: '2026-10',
        closingDate: '2026-10-24',
        dueDate: '2026-11-05',
        status: 'pending',
      }).success,
    ).toBe(false);
  });
});

describe('accountNameSchema (regression)', () => {
  it('still accepts 50 characters and rejects 51', () => {
    expect(accountNameSchema.safeParse('a'.repeat(50)).success).toBe(true);
    expect(accountNameSchema.safeParse('a'.repeat(51)).success).toBe(false);
  });
});
