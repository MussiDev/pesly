import { confirmOccurrenceSchema, createRecurringPaymentSchema } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import {
  buildConfirmRequest,
  buildRecurringPaymentRequest,
  type RecurringPaymentFormValues,
} from '../src/features/recurring/recurring-request';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

function rent(overrides: Partial<RecurringPaymentFormValues> = {}): RecurringPaymentFormValues {
  return {
    name: '  Rent ',
    amount: '350.000,00',
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    frequency: 'monthly',
    weekday: '',
    dayOfMonth: '5',
    month: '',
    startDate: '2026-10-05',
    endDate: '',
    mode: 'confirmation',
    reminderDays: '3',
    ...overrides,
  };
}

describe('buildRecurringPaymentRequest', () => {
  it('converts "350.000,00" (es) to minor units and builds a schema-valid request (AC-01)', () => {
    const result = buildRecurringPaymentRequest(rent(), 'es');

    expect(result.request).toEqual({
      name: 'Rent',
      amount: '35000000',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      frequency: 'monthly',
      dayOfMonth: 5,
      startDate: '2026-10-05',
      mode: 'confirmation',
      reminderDays: 3,
    });
    expect(createRecurringPaymentSchema.safeParse(result.request).success).toBe(true);
  });

  it('converts "350,000.00" (en) to the same minor units (AC-01)', () => {
    const result = buildRecurringPaymentRequest(rent({ amount: '350,000.00' }), 'en');

    expect(result.request?.amount).toBe('35000000');
  });

  it('sends only the fields of a weekly rule, with the end date when given', () => {
    const result = buildRecurringPaymentRequest(
      rent({
        frequency: 'weekly',
        weekday: '0',
        dayOfMonth: '5',
        month: '3',
        endDate: '2027-01-01',
      }),
      'es',
    );

    expect(result.request).toMatchObject({
      frequency: 'weekly',
      weekday: 0,
      endDate: '2027-01-01',
    });
    expect(result.request).not.toHaveProperty('dayOfMonth');
    expect(result.request).not.toHaveProperty('month');
    expect(createRecurringPaymentSchema.safeParse(result.request).success).toBe(true);
  });

  it('accepts a day typed with a leading zero', () => {
    const result = buildRecurringPaymentRequest(rent({ dayOfMonth: '05' }), 'es');

    expect(result.request).toMatchObject({ dayOfMonth: 5 });
  });

  it('builds a yearly rule with month and day', () => {
    const result = buildRecurringPaymentRequest(
      rent({ frequency: 'yearly', month: '2', dayOfMonth: '29', weekday: '3' }),
      'es',
    );

    expect(result.request).toMatchObject({ frequency: 'yearly', month: 2, dayOfMonth: 29 });
    expect(result.request).not.toHaveProperty('weekday');
    expect(createRecurringPaymentSchema.safeParse(result.request).success).toBe(true);
  });

  it.each([
    ['', 'movements.errors.amountInvalid'],
    ['abc', 'movements.errors.amountInvalid'],
    ['1,234,5', 'movements.errors.amountInvalid'],
    ['0', 'movements.errors.amountNotPositive'],
  ])('rejects the amount %j with a message key (AC-02)', (amount, message) => {
    const result = buildRecurringPaymentRequest(rent({ amount }), 'en');

    expect(result.request).toBeUndefined();
    expect(result.fields?.amount).toBe(message);
  });

  it('rejects an empty name and one longer than 80 characters (AC-02)', () => {
    expect(buildRecurringPaymentRequest(rent({ name: '   ' }), 'en').fields?.name).toBe(
      'recurring.errors.nameRequired',
    );
    expect(buildRecurringPaymentRequest(rent({ name: 'x'.repeat(81) }), 'en').fields?.name).toBe(
      'recurring.errors.nameTooLong',
    );
  });

  it('rejects a missing account and category (AC-02)', () => {
    const result = buildRecurringPaymentRequest(rent({ accountId: '', categoryId: '' }), 'en');

    expect(result.fields).toMatchObject({
      accountId: 'movements.errors.accountRequired',
      categoryId: 'movements.errors.categoryRequired',
    });
  });

  it('rejects an end date before the start date (AC-02)', () => {
    const result = buildRecurringPaymentRequest(rent({ endDate: '2026-10-04' }), 'en');

    expect(result.request).toBeUndefined();
    expect(result.fields?.endDate).toBe('recurring.errors.endBeforeStart');
  });

  it('rejects unreal calendar dates (AC-02)', () => {
    const result = buildRecurringPaymentRequest(
      rent({ startDate: '2026-02-30', endDate: '2026-13-01' }),
      'en',
    );

    expect(result.fields).toMatchObject({
      startDate: 'recurring.errors.dateInvalid',
      endDate: 'recurring.errors.dateInvalid',
    });
  });

  it('rejects a weekly rule without weekday and monthly or yearly ones without day or month (AC-02)', () => {
    expect(
      buildRecurringPaymentRequest(rent({ frequency: 'weekly', weekday: '' }), 'en').fields
        ?.weekday,
    ).toBe('recurring.errors.weekdayRequired');
    expect(buildRecurringPaymentRequest(rent({ dayOfMonth: '' }), 'en').fields?.dayOfMonth).toBe(
      'recurring.errors.dayOfMonthRequired',
    );
    expect(
      buildRecurringPaymentRequest(rent({ frequency: 'yearly', month: '' }), 'en').fields?.month,
    ).toBe('recurring.errors.monthRequired');
  });

  it('reads reminder days as a whole number from 0 to 30 and defaults an empty one to 3 (AC-01)', () => {
    expect(buildRecurringPaymentRequest(rent({ reminderDays: '' }), 'es').request).toMatchObject({
      reminderDays: 3,
    });
    expect(buildRecurringPaymentRequest(rent({ reminderDays: '0' }), 'es').request).toMatchObject({
      reminderDays: 0,
    });
    expect(buildRecurringPaymentRequest(rent({ reminderDays: '30' }), 'es').request).toMatchObject({
      reminderDays: 30,
    });
  });

  it.each(['-1', '31', '1.5', 'abc'])('rejects reminder days %s (AC-02)', (reminderDays) => {
    const result = buildRecurringPaymentRequest(rent({ reminderDays }), 'en');
    expect(result.request).toBeUndefined();
    expect(result.fields?.reminderDays).toBe('recurring.errors.reminderDaysInvalid');
  });

  it('rejects out-of-range or non-integer weekday, day and month (AC-02)', () => {
    expect(
      buildRecurringPaymentRequest(rent({ frequency: 'weekly', weekday: '7' }), 'en').fields
        ?.weekday,
    ).toBe('recurring.errors.weekdayRequired');
    expect(buildRecurringPaymentRequest(rent({ dayOfMonth: '32' }), 'en').fields?.dayOfMonth).toBe(
      'recurring.errors.dayOfMonthRequired',
    );
    expect(buildRecurringPaymentRequest(rent({ dayOfMonth: '1.5' }), 'en').fields?.dayOfMonth).toBe(
      'recurring.errors.dayOfMonthRequired',
    );
    expect(
      buildRecurringPaymentRequest(rent({ frequency: 'yearly', month: '13' }), 'en').fields?.month,
    ).toBe('recurring.errors.monthRequired');
  });

  it('rejects a frequency outside the three options (AC-03)', () => {
    const result = buildRecurringPaymentRequest(rent({ frequency: 'daily' }), 'en');

    expect(result.request).toBeUndefined();
    expect(result.fields?.frequency).toBe('recurring.errors.frequencyRequired');
  });

  it('rejects an unknown mode', () => {
    const result = buildRecurringPaymentRequest(rent({ mode: 'whatever' }), 'en');

    expect(result.fields?.mode).toBe('recurring.errors.modeRequired');
  });
});

describe('buildConfirmRequest', () => {
  it('converts the amount and keeps the date (AC-07)', () => {
    const result = buildConfirmRequest({ amount: '48.250,00', date: '2026-10-09' }, 'es');

    expect(result.request).toEqual({ amount: '4825000', date: '2026-10-09' });
    expect(confirmOccurrenceSchema.safeParse(result.request).success).toBe(true);
  });

  it('omits an empty date so the server uses the due date', () => {
    expect(buildConfirmRequest({ amount: '10', date: '' }, 'en').request).toEqual({
      amount: '1000',
    });
  });

  it('rejects an empty, malformed or zero amount and an unreal date (AC-02)', () => {
    expect(buildConfirmRequest({ amount: '', date: '' }, 'en').fields?.amount).toBe(
      'movements.errors.amountInvalid',
    );
    expect(buildConfirmRequest({ amount: '0', date: '' }, 'en').fields?.amount).toBe(
      'movements.errors.amountNotPositive',
    );
    const bad = buildConfirmRequest({ amount: 'x', date: '2026-02-30' }, 'en');
    expect(bad.request).toBeUndefined();
    expect(bad.fields).toMatchObject({
      amount: 'movements.errors.amountInvalid',
      date: 'recurring.errors.dateInvalid',
    });
  });
});
