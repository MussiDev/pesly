import { describe, expect, it } from 'vitest';
import {
  buildStatementPaymentRequest,
  type StatementPaymentFormValues,
  type StatementPaymentRequestContext,
} from '../src/features/credit-cards/statement-payment-request';

const NOW = new Date('2026-10-02T15:30:00.000Z');
const BANK = '00000000-0000-4000-8000-000000000021';
const USD_BANK = '00000000-0000-4000-8000-000000000022';
const OLD_BANK = '00000000-0000-4000-8000-000000000023';

const context: StatementPaymentRequestContext = {
  accounts: [
    { id: BANK, currency: 'ARS', archived: false },
    { id: USD_BANK, currency: 'USD', archived: false },
    { id: OLD_BANK, currency: 'ARS', archived: true },
  ],
  timeZone: 'America/Argentina/Buenos_Aires',
  locale: 'es',
  now: NOW,
};

function values(overrides: Partial<StatementPaymentFormValues> = {}): StatementPaymentFormValues {
  return {
    currency: 'ARS',
    sourceAccountId: BANK,
    amount: '60.000,00',
    occurredAt: '2026-10-02T12:30',
    note: '',
    ...overrides,
  };
}

describe('buildStatementPaymentRequest', () => {
  it('turns "60.000,00", ARS and a source account into the request with an amount of 6000000 (AC-01)', () => {
    expect(buildStatementPaymentRequest(values(), context)).toEqual({
      request: {
        currency: 'ARS',
        sourceAccountId: BANK,
        amount: '6000000',
        occurredAt: '2026-10-02T15:30:00.000Z',
      },
    });
  });

  it('keeps a trimmed note', () => {
    const result = buildStatementPaymentRequest(values({ note: ' Visa octubre ' }), context);
    expect(result.request?.note).toBe('Visa octubre');
  });

  it('refuses a source account of another currency with the currency message (AC-02)', () => {
    expect(buildStatementPaymentRequest(values({ sourceAccountId: USD_BANK }), context)).toEqual({
      fields: { sourceAccount: 'errors.movementCurrencyMismatch' },
    });
  });

  it.each([
    ['a missing source account', { sourceAccountId: '' }, 'sourceAccount'],
    ['an archived source account', { sourceAccountId: OLD_BANK }, 'sourceAccount'],
    ['a missing currency', { currency: '' }, 'currency'],
    ['an empty amount', { amount: '' }, 'amount'],
    ['an amount of 0', { amount: '0' }, 'amount'],
    ['three decimals', { amount: '1,234' }, 'amount'],
    ['a future date', { occurredAt: '2026-10-03T12:30' }, 'occurredAt'],
    ['an invalid date', { occurredAt: 'tomorrow' }, 'occurredAt'],
    ['a zero-width note', { note: 'a​b' }, 'note'],
    ['a note over 500 characters', { note: 'a'.repeat(501) }, 'note'],
  ])('gives a message for %s and no request (invalid input, AC-02)', (_label, patch, field) => {
    const result = buildStatementPaymentRequest(values(patch), context);
    expect(result.request).toBeUndefined();
    expect(Object.keys(result.fields ?? {})).toContain(field);
  });

  it('reports a date skipped by the daylight clock change', () => {
    const result = buildStatementPaymentRequest(values({ occurredAt: '2026-03-08T02:30' }), {
      ...context,
      timeZone: 'America/New_York',
      now: new Date('2026-10-02T15:30:00.000Z'),
    });
    expect(result.fields?.occurredAt).toBe('movements.errors.dateSkipped');
  });

  describe('USD paid from an ARS account', () => {
    const usd = (patch: Partial<StatementPaymentFormValues> = {}) =>
      values({ currency: 'USD', amount: '59,59', pesosAmount: '91.470,65', ...patch });

    it('adds the pesos debited as minor units to the request', () => {
      expect(buildStatementPaymentRequest(usd(), context)).toEqual({
        request: {
          currency: 'USD',
          sourceAccountId: BANK,
          amount: '5959',
          pesosAmount: '9147065',
          occurredAt: '2026-10-02T15:30:00.000Z',
        },
      });
    });

    it.each([
      ['empty', ''],
      ['zero', '0'],
      ['with three decimals', '1,234'],
    ])('gives a pesos message when the pesos are %s and no request', (_label, pesosAmount) => {
      const result = buildStatementPaymentRequest(usd({ pesosAmount }), context);
      expect(result.request).toBeUndefined();
      expect(Object.keys(result.fields ?? {})).toEqual(['pesosAmount']);
    });

    it('does not send the pesos for a USD account, and still refuses a USD account for ARS', () => {
      const same = buildStatementPaymentRequest(usd({ sourceAccountId: USD_BANK }), context);
      expect(same.request).toEqual({
        currency: 'USD',
        sourceAccountId: USD_BANK,
        amount: '5959',
        occurredAt: '2026-10-02T15:30:00.000Z',
      });
      expect(
        buildStatementPaymentRequest(values({ sourceAccountId: USD_BANK }), context).fields,
      ).toEqual({ sourceAccount: 'errors.movementCurrencyMismatch' });
    });
  });
});
