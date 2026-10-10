import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors';
import {
  RECURRING_FREQUENCIES,
  confirmOccurrenceSchema,
  createRecurringPaymentSchema,
  frequencySchema,
  modeSchema,
  occurrenceParamsSchema,
  recurringPaymentResponseSchema,
  updateRecurringPaymentSchema,
  upcomingResponseSchema,
} from '../src/recurring';
import * as shared from '../src/index';

const ID = '0b6f5d2e-6c1c-4f3e-9a55-3d9d3c1c2a10';
const ID2 = '1c7a6e3f-7d2d-4a4f-8b66-4e0e4d2d3b21';

const rent = {
  name: 'Rent',
  amount: '35000000',
  accountId: ID,
  categoryId: ID2,
  frequency: 'monthly',
  dayOfMonth: 5,
  startDate: '2026-11-05',
  mode: 'confirmation',
};

describe('createRecurringPaymentSchema', () => {
  it('accepts the Rent payload (AC-01)', () => {
    const parsed = createRecurringPaymentSchema.parse({ ...rent, name: '  Rent  ' });
    expect(parsed.name).toBe('Rent');
    expect(parsed.frequency).toBe('monthly');
    expect(parsed.endDate).toBeUndefined();
  });

  it('accepts weekly and yearly rules', () => {
    expect(
      createRecurringPaymentSchema.safeParse({
        ...rent,
        frequency: 'weekly',
        dayOfMonth: undefined,
        weekday: 0,
      }).success,
    ).toBe(true);
    expect(
      createRecurringPaymentSchema.safeParse({ ...rent, frequency: 'yearly', month: 12 }).success,
    ).toBe(true);
  });

  const rejected: [string, Record<string, unknown>][] = [
    ['zero amount', { amount: '0' }],
    ['negative amount', { amount: '-5' }],
    ['decimal amount', { amount: '1.5' }],
    ['amount above the maximum', { amount: '1000000000000001' }],
    ['empty name', { name: '   ' }],
    ['name over 80 characters', { name: 'a'.repeat(81) }],
    ['endDate before startDate', { endDate: '2026-11-04' }],
    ['monthly without dayOfMonth', { dayOfMonth: undefined }],
    ['weekly with dayOfMonth', { frequency: 'weekly', weekday: 1 }],
    ['weekly without weekday', { frequency: 'weekly', dayOfMonth: undefined }],
    ['weekday 7', { frequency: 'weekly', dayOfMonth: undefined, weekday: 7 }],
    ['monthly with month', { month: 3 }],
    ['monthly with weekday', { weekday: 2 }],
    ['yearly without month', { frequency: 'yearly' }],
    ['month 13', { frequency: 'yearly', month: 13 }],
    ['dayOfMonth 32', { dayOfMonth: 32 }],
    ['unreal startDate', { startDate: '2027-02-29' }],
    ['non uuid accountId', { accountId: 'abc' }],
    ['unknown frequency', { frequency: 'daily' }],
    ['unknown mode', { mode: 'manual' }],
  ];

  it.each(rejected)('rejects %s (AC-02)', (_label, patch) => {
    expect(createRecurringPaymentSchema.safeParse({ ...rent, ...patch }).success).toBe(false);
  });

  it('accepts endDate equal to startDate', () => {
    expect(createRecurringPaymentSchema.safeParse({ ...rent, endDate: '2026-11-05' }).success).toBe(
      true,
    );
  });
});

describe('frequency and mode enums', () => {
  it('is exactly weekly, monthly, yearly (AC-03)', () => {
    expect([...RECURRING_FREQUENCIES]).toEqual(['weekly', 'monthly', 'yearly']);
    expect(frequencySchema.options).toEqual(['weekly', 'monthly', 'yearly']);
    expect(frequencySchema.safeParse('daily').success).toBe(false);
    expect(modeSchema.options).toEqual(['automatic', 'confirmation']);
  });
});

describe('updateRecurringPaymentSchema', () => {
  it('requires at least one field', () => {
    expect(updateRecurringPaymentSchema.safeParse({}).success).toBe(false);
    expect(updateRecurringPaymentSchema.safeParse({ name: 'Flat' }).success).toBe(true);
  });

  it('still rejects an invalid field', () => {
    expect(updateRecurringPaymentSchema.safeParse({ amount: '0' }).success).toBe(false);
  });

  it('rejects fields foreign to a stated frequency', () => {
    expect(
      updateRecurringPaymentSchema.safeParse({ frequency: 'weekly', dayOfMonth: 3 }).success,
    ).toBe(false);
  });
});

describe('response schemas', () => {
  it('parses a payment response', () => {
    const payment = {
      id: ID,
      ...rent,
      weekday: null,
      month: null,
      endDate: null,
      status: 'active',
      nextDueDate: '2026-11-05',
    };
    expect(recurringPaymentResponseSchema.safeParse(payment).success).toBe(true);
    expect(
      recurringPaymentResponseSchema.safeParse({ ...payment, status: 'deleted' }).success,
    ).toBe(false);
  });

  it('parses upcoming items', () => {
    const item = {
      kind: 'pending',
      dueDate: '2026-11-05',
      paymentId: ID,
      name: 'Rent',
      amount: '35000000',
      accountId: ID,
      categoryId: ID2,
      occurrenceId: ID2,
    };
    expect(upcomingResponseSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(
      upcomingResponseSchema.safeParse({
        items: [{ ...item, kind: 'scheduled', occurrenceId: null }],
      }).success,
    ).toBe(true);
    expect(upcomingResponseSchema.safeParse({ items: [{ ...item, kind: 'x' }] }).success).toBe(
      false,
    );
  });

  it('confirmOccurrenceSchema takes optional amount and date', () => {
    expect(confirmOccurrenceSchema.safeParse({}).success).toBe(true);
    expect(confirmOccurrenceSchema.safeParse({ amount: '100', date: '2026-11-05' }).success).toBe(
      true,
    );
    expect(confirmOccurrenceSchema.safeParse({ amount: '0' }).success).toBe(false);
    expect(confirmOccurrenceSchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
  });
});

describe('error codes and exports', () => {
  it('declares the two recurring codes', () => {
    expect(ERROR_CODES).toContain('RECURRING_OCCURRENCE_NOT_PENDING');
    expect(ERROR_CODES).toContain('RECURRING_LIMIT_REACHED');
  });

  it('re-exports the recurring module from the package index', () => {
    expect(shared.createRecurringPaymentSchema).toBe(createRecurringPaymentSchema);
    expect(shared.dueDatesBetween).toBeTypeOf('function');
  });
});

describe('occurrenceParamsSchema', () => {
  it('takes the occurrence id alone, as the web client builds /recurring/occurrences/:id', () => {
    expect(occurrenceParamsSchema.parse({ id: ID })).toEqual({ id: ID });
  });

  it.each([{}, { id: 'not-a-uuid' }, { occurrenceId: ID }])('rejects %o', (value) => {
    expect(occurrenceParamsSchema.safeParse(value).success).toBe(false);
  });
});
