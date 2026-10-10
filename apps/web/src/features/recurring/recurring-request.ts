import {
  RECURRING_FREQUENCIES,
  RECURRING_MODES,
  RECURRING_NAME_MAX_LENGTH,
  REMINDER_DAYS_DEFAULT,
  formatMinorUnitsString,
  isCalendarDate,
  type ConfirmOccurrence,
  type CreateRecurringPayment,
} from '@pesly/shared';
import type { MovementFieldMessage } from '@/features/movements/movement-form-errors';
import { parseAmountField } from '@/features/movements/movement-request';

export type RecurringFieldName =
  | 'name'
  | 'amount'
  | 'accountId'
  | 'categoryId'
  | 'frequency'
  | 'weekday'
  | 'dayOfMonth'
  | 'month'
  | 'startDate'
  | 'endDate'
  | 'mode'
  | 'reminderDays';

/** Catalog paths: the movement wordings for amount, account and category, plus `recurring.errors`. */
export type RecurringFieldMessage =
  | MovementFieldMessage
  | 'recurring.errors.nameRequired'
  | 'recurring.errors.nameTooLong'
  | 'recurring.errors.frequencyRequired'
  | 'recurring.errors.weekdayRequired'
  | 'recurring.errors.dayOfMonthRequired'
  | 'recurring.errors.monthRequired'
  | 'recurring.errors.dateInvalid'
  | 'recurring.errors.endBeforeStart'
  | 'recurring.errors.modeRequired'
  | 'recurring.errors.reminderDaysInvalid';

export type RecurringFieldErrors = Partial<Record<RecurringFieldName, RecurringFieldMessage>>;

/** Everything is text, as typed or selected; empty means "not chosen". */
export interface RecurringPaymentFormValues {
  name: string;
  amount: string;
  accountId: string;
  categoryId: string;
  frequency: string;
  /** 0 to 6, Monday = 0. */
  weekday: string;
  dayOfMonth: string;
  month: string;
  startDate: string;
  endDate: string;
  mode: string;
  /** Whole days, 0 to 30; empty means the default. */
  reminderDays: string;
}

export type RecurringPaymentRequestResult =
  | { request: CreateRecurringPayment; fields?: undefined }
  | { request?: undefined; fields: RecurringFieldErrors };

export interface ConfirmFormValues {
  amount: string;
  /** Empty keeps the due date. */
  date: string;
}

export type ConfirmRequestResult =
  | { request: ConfirmOccurrence; fields?: undefined }
  | {
      request?: undefined;
      fields: { amount?: RecurringFieldMessage; date?: RecurringFieldMessage };
    };

/** Reads a whole number in `min..max` from select-like text without going through a float. */
function readInteger(text: string, min: number, max: number): number | undefined {
  const digits = text.trim().replace(/^0+(?=\d)/, '');
  for (let candidate = min; candidate <= max; candidate += 1) {
    if (String(candidate) === digits) return candidate;
  }
  return undefined;
}

function isFrequency(value: string): value is CreateRecurringPayment['frequency'] {
  return (RECURRING_FREQUENCIES as readonly string[]).includes(value);
}

function isMode(value: string): value is CreateRecurringPayment['mode'] {
  return (RECURRING_MODES as readonly string[]).includes(value);
}

/**
 * The request to send for what the user entered, or the per-field messages explaining why there is
 * none. Only the fields that belong to the chosen frequency are sent; the API validates again.
 */
export function buildRecurringPaymentRequest(
  values: RecurringPaymentFormValues,
  locale: string,
): RecurringPaymentRequestResult {
  const fields: RecurringFieldErrors = {};

  const name = values.name.trim();
  if (name === '') fields.name = 'recurring.errors.nameRequired';
  else if (name.length > RECURRING_NAME_MAX_LENGTH) fields.name = 'recurring.errors.nameTooLong';

  const amount = parseAmountField(values.amount, locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  if (values.accountId === '') fields.accountId = 'movements.errors.accountRequired';
  if (values.categoryId === '') fields.categoryId = 'movements.errors.categoryRequired';

  const frequency = isFrequency(values.frequency) ? values.frequency : undefined;
  if (frequency === undefined) fields.frequency = 'recurring.errors.frequencyRequired';
  const mode = isMode(values.mode) ? values.mode : undefined;
  if (mode === undefined) fields.mode = 'recurring.errors.modeRequired';

  const weekday = readInteger(values.weekday, 0, 6);
  if (frequency === 'weekly' && weekday === undefined) {
    fields.weekday = 'recurring.errors.weekdayRequired';
  }
  const dayOfMonth = readInteger(values.dayOfMonth, 1, 31);
  if ((frequency === 'monthly' || frequency === 'yearly') && dayOfMonth === undefined) {
    fields.dayOfMonth = 'recurring.errors.dayOfMonthRequired';
  }
  const month = readInteger(values.month, 1, 12);
  if (frequency === 'yearly' && month === undefined) {
    fields.month = 'recurring.errors.monthRequired';
  }

  const reminderDays =
    values.reminderDays.trim() === ''
      ? REMINDER_DAYS_DEFAULT
      : readInteger(values.reminderDays, 0, 30);
  if (reminderDays === undefined) fields.reminderDays = 'recurring.errors.reminderDaysInvalid';

  const startValid = isCalendarDate(values.startDate);
  if (!startValid) fields.startDate = 'recurring.errors.dateInvalid';
  const hasEnd = values.endDate !== '';
  const endValid = hasEnd && isCalendarDate(values.endDate);
  if (hasEnd && !endValid) fields.endDate = 'recurring.errors.dateInvalid';
  else if (endValid && startValid && values.endDate < values.startDate) {
    fields.endDate = 'recurring.errors.endBeforeStart';
  }

  if (
    Object.keys(fields).length > 0 ||
    amount.amount === undefined ||
    frequency === undefined ||
    mode === undefined ||
    reminderDays === undefined
  ) {
    return { fields };
  }

  return {
    request: {
      name,
      amount: formatMinorUnitsString(amount.amount),
      accountId: values.accountId,
      categoryId: values.categoryId,
      frequency,
      ...(frequency === 'weekly' && weekday !== undefined ? { weekday } : {}),
      ...(frequency !== 'weekly' && dayOfMonth !== undefined ? { dayOfMonth } : {}),
      ...(frequency === 'yearly' && month !== undefined ? { month } : {}),
      startDate: values.startDate,
      ...(endValid ? { endDate: values.endDate } : {}),
      mode,
      reminderDays,
    },
  };
}

/** The confirm form always carries an amount (prefilled); an empty date means the due date. */
export function buildConfirmRequest(
  values: ConfirmFormValues,
  locale: string,
): ConfirmRequestResult {
  const fields: { amount?: RecurringFieldMessage; date?: RecurringFieldMessage } = {};
  const amount = parseAmountField(values.amount, locale);
  if (amount.message !== undefined) fields.amount = amount.message;
  const hasDate = values.date !== '';
  if (hasDate && !isCalendarDate(values.date)) fields.date = 'recurring.errors.dateInvalid';

  if (Object.keys(fields).length > 0 || amount.amount === undefined) return { fields };
  return {
    request: {
      amount: formatMinorUnitsString(amount.amount),
      ...(hasDate ? { date: values.date } : {}),
    },
  };
}
