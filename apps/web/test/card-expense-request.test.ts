import { describe, expect, it } from 'vitest';
import {
  buildCardExpenseRequest,
  type CardExpenseFormValues,
  type CardExpenseRequestContext,
} from '../src/features/credit-cards/card-expense-request';

const NOW = new Date('2026-10-02T15:30:00.000Z');
const COMIDA = '00000000-0000-4000-8000-000000000011';

const context: CardExpenseRequestContext = {
  categories: [{ id: COMIDA, archived: false }],
  timeZone: 'America/Argentina/Buenos_Aires',
  locale: 'es',
  now: NOW,
};

function values(overrides: Partial<CardExpenseFormValues> = {}): CardExpenseFormValues {
  return {
    currency: 'USD',
    categoryId: COMIDA,
    amount: '15,99',
    occurredAt: '2026-10-02T12:30',
    note: '',
    ...overrides,
  };
}

describe('buildCardExpenseRequest', () => {
  it('turns "15,99", USD and a category into the request with an amount of 1599 (AC-01)', () => {
    expect(buildCardExpenseRequest(values(), context)).toEqual({
      request: {
        currency: 'USD',
        categoryId: COMIDA,
        amount: '1599',
        occurredAt: '2026-10-02T15:30:00.000Z',
        rate: { source: 'automatic' },
      },
    });
  });

  it('keeps a trimmed note and builds an ARS request (FR-01)', () => {
    const result = buildCardExpenseRequest(
      values({ currency: 'ARS', amount: '1.000,00', note: '  cena  ' }),
      context,
    );
    expect(result.request).toMatchObject({ currency: 'ARS', amount: '100000', note: 'cena' });
  });

  it.each([
    ['empty', '', 'movements.errors.amountInvalid'],
    ['zero', '0', 'movements.errors.amountNotPositive'],
    ['three decimals', '1,234', 'movements.errors.amountInvalid'],
  ])('refuses a %s amount with a field message and no request (FR-01)', (_name, amount, key) => {
    expect(buildCardExpenseRequest(values({ amount }), context)).toEqual({
      fields: { amount: key },
    });
  });

  it('refuses a missing or unknown category (FR-01)', () => {
    expect(buildCardExpenseRequest(values({ categoryId: '' }), context)).toEqual({
      fields: { category: 'movements.errors.categoryRequired' },
    });
    const archived = { ...context, categories: [{ id: COMIDA, archived: true }] };
    expect(buildCardExpenseRequest(values(), archived).fields).toEqual({
      category: 'movements.errors.categoryRequired',
    });
  });

  it('refuses a currency other than ARS or USD (FR-01)', () => {
    expect(buildCardExpenseRequest(values({ currency: 'EUR' }), context)).toEqual({
      fields: { currency: 'creditCards.expense.errors.currencyRequired' },
    });
  });

  it('refuses a date later than today in the user time zone, but accepts late evening there (FR-01)', () => {
    expect(buildCardExpenseRequest(values({ occurredAt: '2026-10-03T00:00' }), context)).toEqual({
      fields: { occurredAt: 'errors.movementDateInFuture' },
    });
    // 23:30 in Buenos Aires is 02:30 UTC of the next day, still today there.
    const late = { ...context, now: new Date('2026-10-03T02:45:00.000Z') };
    expect(
      buildCardExpenseRequest(values({ occurredAt: '2026-10-02T23:30' }), late).request,
    ).toBeDefined();
  });

  it('refuses a malformed date and a skipped wall-clock time (FR-01)', () => {
    expect(buildCardExpenseRequest(values({ occurredAt: '' }), context)).toEqual({
      fields: { occurredAt: 'movements.errors.dateInvalid' },
    });
    const newYork = { ...context, timeZone: 'America/New_York' };
    expect(
      buildCardExpenseRequest(values({ occurredAt: '2026-03-08T02:30' }), {
        ...newYork,
        now: new Date('2026-06-01T12:00:00.000Z'),
      }),
    ).toEqual({ fields: { occurredAt: 'movements.errors.dateSkipped' } });
  });

  it('refuses a note that is too long (FR-01)', () => {
    expect(buildCardExpenseRequest(values({ note: 'x'.repeat(501) }), context)).toEqual({
      fields: { note: 'movements.errors.noteTooLong' },
    });
  });

  it('reports every invalid field at once (FR-01)', () => {
    const result = buildCardExpenseRequest(values({ amount: '', categoryId: '' }), context);
    expect(result.request).toBeUndefined();
    expect(Object.keys(result.fields ?? {}).sort()).toEqual(['amount', 'category']);
  });
});
