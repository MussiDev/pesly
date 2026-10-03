import { describe, expect, it } from 'vitest';
import type { MovementFormValues } from '../src/features/movements/components/movement-form';
import {
  buildMovementRequest,
  type MovementRequestContext,
} from '../src/features/movements/movement-request';
import { impliedRatePreview } from '../src/features/movements/implied-rate-preview';

const NOW = new Date('2026-10-02T15:30:00.000Z');
const CAJA = '00000000-0000-4000-8000-000000000001';
const DOLARES = '00000000-0000-4000-8000-000000000002';
const BANCO = '00000000-0000-4000-8000-000000000003';
const VIEJA = '00000000-0000-4000-8000-000000000004';
const COMIDA = '00000000-0000-4000-8000-000000000011';

const ACCOUNTS = [
  { id: CAJA, currency: 'ARS', archived: false },
  { id: DOLARES, currency: 'USD', archived: false },
  { id: BANCO, currency: 'ARS', archived: false },
  { id: VIEJA, currency: 'ARS', archived: true },
];

function context(overrides: Partial<MovementRequestContext> = {}): MovementRequestContext {
  return {
    accounts: ACCOUNTS,
    categories: [{ id: COMIDA, kind: 'expense', archived: false }],
    timeZone: 'America/Argentina/Buenos_Aires',
    locale: 'es',
    now: NOW,
    defaultRate: '1250,5',
    ...overrides,
  };
}

function values(overrides: Partial<MovementFormValues> = {}): MovementFormValues {
  return {
    type: 'transfer',
    accountId: CAJA,
    categoryId: '',
    amount: '1.000,00',
    occurredAt: '2026-10-02T12:30',
    rate: '1250,5',
    rateEdited: false,
    note: '',
    destinationAccountId: BANCO,
    ...overrides,
  };
}

describe('buildMovementRequest: transfer (AC-01, AC-02)', () => {
  it('builds a transfer with both account ids, integer-string amount, no category and no rate', () => {
    expect(buildMovementRequest(values(), context())).toEqual({
      request: {
        type: 'transfer',
        accountId: CAJA,
        destinationAccountId: BANCO,
        amount: '100000',
        occurredAt: '2026-10-02T15:30:00.000Z',
      },
    });
  });

  it('includes the trimmed note', () => {
    const result = buildMovementRequest(values({ note: '  Ahorro  ' }), context());

    expect(result.request).toMatchObject({ note: 'Ahorro' });
  });

  it('rejects a destination equal to the source (invalid input) (AC-02)', () => {
    const result = buildMovementRequest(values({ destinationAccountId: CAJA }), context());

    expect(result.request).toBeUndefined();
    expect(result.fields).toEqual({ destinationAccount: 'errors.movementSameAccount' });
  });

  it('rejects a destination of another currency (invalid input) (AC-02)', () => {
    const result = buildMovementRequest(values({ destinationAccountId: DOLARES }), context());

    expect(result.fields).toEqual({ destinationAccount: 'errors.movementCurrencyMismatch' });
  });

  it.each(['', 'unknown', VIEJA])('requires a usable destination, not %j (invalid input)', (id) => {
    const result = buildMovementRequest(values({ destinationAccountId: id }), context());

    expect(result.fields).toEqual({ destinationAccount: 'movements.errors.destinationRequired' });
  });

  it('requires the source account (invalid input)', () => {
    const result = buildMovementRequest(values({ accountId: '' }), context());

    expect(result.fields?.account).toBe('movements.errors.accountRequired');
  });

  it.each([
    ['0', 'movements.errors.amountNotPositive'],
    ['abc', 'movements.errors.amountInvalid'],
    ['1,234', 'movements.errors.amountInvalid'],
    ['10.000.000.000.000,01', 'movements.errors.amountOutOfRange'],
  ])('rejects the amount %j (invalid input) (AC-11)', (amount, message) => {
    const result = buildMovementRequest(values({ amount }), context());

    expect(result.request).toBeUndefined();
    expect(result.fields).toEqual({ amount: message });
  });

  it('accepts exactly 10^15 minor units', () => {
    const result = buildMovementRequest(values({ amount: '10.000.000.000.000,00' }), context());

    expect(result.request).toMatchObject({ amount: '1000000000000000' });
  });

  it('rejects a note over 500 characters (invalid input) (AC-12)', () => {
    const result = buildMovementRequest(values({ note: 'x'.repeat(501) }), context());

    expect(result.fields).toEqual({ note: 'movements.errors.noteTooLong' });
  });

  it('rejects a later local date (invalid input) (AC-07)', () => {
    const result = buildMovementRequest(values({ occurredAt: '2026-10-03T10:00' }), context());

    expect(result.fields).toEqual({ occurredAt: 'errors.movementDateInFuture' });
  });

  it('does not ask for a rate or a category on a transfer', () => {
    const result = buildMovementRequest(values({ rate: '', rateEdited: true }), context());

    expect(result.fields).toBeUndefined();
  });
});

describe('buildMovementRequest: exchange (AC-03, AC-04)', () => {
  const exchange = (overrides: Partial<MovementFormValues> = {}) =>
    values({
      type: 'exchange',
      destinationAccountId: DOLARES,
      amount: '1.557.300,00',
      destinationAmount: '1.000,00',
      ...overrides,
    });

  it('builds an exchange with both amounts and never a rate', () => {
    const result = buildMovementRequest(exchange({ rateEdited: true, rate: '999' }), context());

    expect(result).toEqual({
      request: {
        type: 'exchange',
        accountId: CAJA,
        destinationAccountId: DOLARES,
        amount: '155730000',
        destinationAmount: '100000',
        occurredAt: '2026-10-02T15:30:00.000Z',
      },
    });
  });

  it('rejects a destination of the same currency (invalid input) (AC-04)', () => {
    const result = buildMovementRequest(exchange({ destinationAccountId: BANCO }), context());

    expect(result.fields).toEqual({ destinationAccount: 'errors.exchangeSameCurrency' });
  });

  it('rejects a destination equal to the source (invalid input)', () => {
    const result = buildMovementRequest(exchange({ destinationAccountId: CAJA }), context());

    expect(result.fields).toEqual({ destinationAccount: 'errors.movementSameAccount' });
  });

  it.each([
    ['0', 'movements.errors.amountNotPositive'],
    ['', 'movements.errors.amountInvalid'],
    ['10.000.000.000.000,01', 'movements.errors.amountOutOfRange'],
  ])(
    'validates the amount entering the destination: %j (invalid input) (AC-11)',
    (typed, message) => {
      const result = buildMovementRequest(exchange({ destinationAmount: typed }), context());

      expect(result.request).toBeUndefined();
      expect(result.fields).toEqual({ destinationAmount: message });
    },
  );

  it('validates both amounts independently', () => {
    const result = buildMovementRequest(
      exchange({ amount: '0', destinationAmount: '0' }),
      context(),
    );

    expect(Object.keys(result.fields ?? {}).sort()).toEqual(['amount', 'destinationAmount']);
  });

  it('does not block an out-of-range implied rate: the API decides (AC-15)', () => {
    const result = buildMovementRequest(
      exchange({ amount: '0,01', destinationAmount: '1.000,00' }),
      context(),
    );

    expect(result.request).toMatchObject({
      type: 'exchange',
      amount: '1',
      destinationAmount: '100000',
    });
  });
});

describe('buildMovementRequest: expense and income as in 03b (AC-06)', () => {
  const expense = (overrides: Partial<MovementFormValues> = {}) =>
    values({ type: 'expense', categoryId: COMIDA, destinationAccountId: undefined, ...overrides });

  it('keeps the automatic rate while untouched', () => {
    expect(buildMovementRequest(expense(), context())).toEqual({
      request: {
        type: 'expense',
        accountId: CAJA,
        categoryId: COMIDA,
        amount: '100000',
        occurredAt: '2026-10-02T15:30:00.000Z',
        rate: { source: 'automatic' },
      },
    });
  });

  it('sends a manual rate scaled by 10,000 once edited', () => {
    const result = buildMovementRequest(expense({ rateEdited: true, rate: '1.300,25' }), context());

    expect(result.request).toMatchObject({ rate: { source: 'manual', value: '13002500' } });
  });

  it('requires a category and a rate when none is stored', () => {
    const result = buildMovementRequest(
      expense({ categoryId: '', rate: '' }),
      context({ defaultRate: '' }),
    );

    expect(result.fields).toEqual({
      category: 'movements.errors.categoryRequired',
      rate: 'movements.errors.rateRequired',
    });
  });
});

describe('impliedRatePreview (AC-05, AC-14, AC-15)', () => {
  const accounts = [
    { id: 'ars', currency: 'ARS' },
    { id: 'usd', currency: 'USD' },
    { id: 'ars2', currency: 'ARS' },
  ];
  const input = (overrides: Partial<Parameters<typeof impliedRatePreview>[0]> = {}) => ({
    accountId: 'ars',
    destinationAccountId: 'usd',
    amount: '1,557,300.00',
    destinationAmount: '1,000.00',
    ...overrides,
  });

  it('shows 1,557.3000 for 1,557,300.00 ARS and 1,000.00 USD', () => {
    expect(impliedRatePreview(input(), accounts, 'en')).toEqual({
      kind: 'rate',
      text: '1,557.3000',
    });
  });

  it('shows 666.6667 for 2,000.00 ARS and 3.00 USD', () => {
    expect(
      impliedRatePreview(input({ amount: '2,000.00', destinationAmount: '3.00' }), accounts, 'en'),
    ).toEqual({ kind: 'rate', text: '666.6667' });
  });

  it('takes the ARS amount from the destination when the source is the USD account', () => {
    expect(
      impliedRatePreview(
        input({
          accountId: 'usd',
          destinationAccountId: 'ars',
          amount: '3.00',
          destinationAmount: '2,000.00',
        }),
        accounts,
        'en',
      ),
    ).toEqual({ kind: 'rate', text: '666.6667' });
  });

  it('formats with the Spanish notation', () => {
    expect(
      impliedRatePreview(
        input({ amount: '1.557.300,00', destinationAmount: '1.000,00' }),
        accounts,
        'es',
      ),
    ).toEqual({ kind: 'rate', text: '1557,3000' });
  });

  it('is out of range when the rate rounds to 0 or exceeds the maximum', () => {
    expect(
      impliedRatePreview(input({ amount: '0.01', destinationAmount: '1,000.00' }), accounts, 'en'),
    ).toEqual({ kind: 'out-of-range' });
    expect(
      impliedRatePreview(
        input({ amount: '10,000,000,000,000.00', destinationAmount: '0.01' }),
        accounts,
        'en',
      ),
    ).toEqual({ kind: 'out-of-range' });
  });

  it.each([
    ['an amount that is not valid', { amount: 'abc' }],
    ['an amount of 0', { destinationAmount: '0' }],
    ['an empty destination amount', { destinationAmount: '' }],
    ['an amount above 10^15 minor units', { amount: '10,000,000,000,000.01' }],
    ['no destination', { destinationAccountId: '' }],
    ['two accounts of the same currency', { destinationAccountId: 'ars2' }],
  ])('is empty with %s', (_name, overrides) => {
    expect(impliedRatePreview(input(overrides), accounts, 'en')).toEqual({ kind: 'empty' });
  });
});
