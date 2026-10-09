import { describe, expect, it } from 'vitest';
import { statementResponseSchema } from '../src/credit-cards/credit-card';
import {
  createStatementPaymentRequestSchema,
  statementPaymentResponseSchema,
} from '../src/credit-cards/statement-payment';

const UUID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const VALID = {
  currency: 'ARS',
  sourceAccountId: UUID,
  amount: '6000000',
  occurredAt: '2026-10-05T15:30:00.000Z',
};
const STATEMENT = {
  id: UUID,
  cardId: UUID,
  period: '2026-09',
  closingDate: '2026-09-24',
  dueDate: '2026-10-05',
  status: 'closed',
  totals: { ARS: '6000000', USD: '0' },
  installments: [],
};

describe('createStatementPaymentRequestSchema', () => {
  it('accepts a payment of 60,000.00 ARS from a UUID account (AC-01)', () => {
    expect(createStatementPaymentRequestSchema.safeParse(VALID).success).toBe(true);
    expect(
      createStatementPaymentRequestSchema.safeParse({ ...VALID, currency: 'USD', note: 'May' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['an amount of 0', { amount: '0' }],
    ['a negative amount', { amount: '-5' }],
    ['a decimal amount', { amount: '15.99' }],
    ['a leading-zero amount', { amount: '015' }],
    ['a missing source account', { sourceAccountId: undefined }],
    ['a non-UUID source account', { sourceAccountId: '../x' }],
    ['currency EUR', { currency: 'EUR' }],
    ['a destination key', { destinationAccountId: UUID }],
    ['an unknown key', { extra: 1 }],
  ])('rejects %s as invalid input (FR-01)', (_label, patch) => {
    expect(createStatementPaymentRequestSchema.safeParse({ ...VALID, ...patch }).success).toBe(
      false,
    );
  });

  it('reports only the failing paths, not the typed values (sad path)', () => {
    const result = createStatementPaymentRequestSchema.safeParse({ ...VALID, amount: 'secret-1' });
    const paths = result.error?.issues.map((issue) => issue.path.join('.')) ?? [];
    expect(paths).toContain('amount');
    expect(JSON.stringify(paths)).not.toContain('secret');
  });
});

describe('createStatementPaymentRequestSchema, USD from pesos', () => {
  const USD = { ...VALID, currency: 'USD', amount: '5959' };

  it('accepts the pesos debited or the rate, one of them', () => {
    expect(
      createStatementPaymentRequestSchema.safeParse({ ...USD, pesosAmount: '9147065' }).success,
    ).toBe(true);
    expect(
      createStatementPaymentRequestSchema.safeParse({ ...USD, rate: '15350000' }).success,
    ).toBe(true);
  });

  it.each([
    ['both the pesos and the rate', { ...USD, pesosAmount: '9147065', rate: '15350000' }],
    ['pesos on an ARS payment', { ...VALID, pesosAmount: '100' }],
    ['a rate on an ARS payment', { ...VALID, rate: '15350000' }],
    ['zero pesos', { ...USD, pesosAmount: '0' }],
    ['decimal pesos', { ...USD, pesosAmount: '10.5' }],
    ['a zero rate', { ...USD, rate: '0' }],
    ['a rate above the maximum', { ...USD, rate: '100000000001' }],
    ['a float rate', { ...USD, rate: '1535.5' }],
  ])('rejects %s', (_label, body) => {
    expect(createStatementPaymentRequestSchema.safeParse(body).success).toBe(false);
  });

  it('parses the exchange data of a response', () => {
    expect(
      statementPaymentResponseSchema.safeParse({
        movementId: UUID,
        sourceAccountId: UUID,
        accountId: UUID,
        currency: 'USD',
        amount: '5959',
        exchange: { pesosAmount: '9147065', rate: '15350000' },
        occurredAt: '2026-10-05T15:30:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('statement payments in the response', () => {
  it('parses the payment response', () => {
    expect(
      statementPaymentResponseSchema.safeParse({
        movementId: UUID,
        sourceAccountId: UUID,
        accountId: UUID,
        currency: 'ARS',
        amount: '6000000',
        exchange: null,
        occurredAt: '2026-10-05T15:30:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('parses a closed statement paid and partially paid, and an open one with null (AC-03, AC-04)', () => {
    const paid = {
      ARS: { paid: '6000000', status: 'paid' },
      USD: { paid: '0', status: 'paid' },
    };
    const partial = {
      ARS: { paid: '2000000', status: 'partially_paid' },
      USD: { paid: '0', status: 'paid' },
    };
    expect(statementResponseSchema.safeParse({ ...STATEMENT, payments: paid }).success).toBe(true);
    expect(statementResponseSchema.safeParse({ ...STATEMENT, payments: partial }).success).toBe(
      true,
    );
    expect(
      statementResponseSchema.safeParse({ ...STATEMENT, status: 'open', payments: null }).success,
    ).toBe(true);
  });

  it('rejects a status outside the three values and a missing payments key (AC-03)', () => {
    const wrong = { ARS: { paid: '1', status: 'late' }, USD: { paid: '0', status: 'paid' } };
    expect(statementResponseSchema.safeParse({ ...STATEMENT, payments: wrong }).success).toBe(
      false,
    );
    expect(statementResponseSchema.safeParse(STATEMENT).success).toBe(false);
  });
});
