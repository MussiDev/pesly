import {
  dateInTimeZone,
  formatMinorUnitsString,
  movementNoteSchema,
  occurredAtSchema,
  todayInTimeZone,
  zonedLocalToInstant,
  type CreateCardExpenseRequest,
} from '@pesly/shared';
import type { MovementFieldMessage } from '@/features/movements/movement-form-errors';
import { parseAmountField } from '@/features/movements/movement-request';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

export type CardExpenseFieldName = 'currency' | 'category' | 'amount' | 'occurredAt' | 'note';

/** Catalog paths: the movement validation wordings, plus the card's own currency one. */
export type CardExpenseFieldMessage =
  MovementFieldMessage | 'creditCards.expense.errors.currencyRequired';

export type CardExpenseFieldErrors = Partial<Record<CardExpenseFieldName, CardExpenseFieldMessage>>;

export interface CardExpenseFormValues {
  currency: string;
  categoryId: string;
  amount: string;
  /** `datetime-local` value, in the user's time zone. */
  occurredAt: string;
  note: string;
}

export interface CardExpenseRequestContext {
  /** The open expense categories the person can pick. */
  categories: readonly { id: string; archived: boolean }[];
  timeZone: string;
  locale: string;
  now: Date;
}

export type CardExpenseRequestResult =
  | { request: CreateCardExpenseRequest; fields?: undefined }
  | { request?: undefined; fields: CardExpenseFieldErrors };

function toCurrency(value: string): CreateCardExpenseRequest['currency'] | undefined {
  return value === 'ARS' || value === 'USD' ? value : undefined;
}

/**
 * The request to send for what the user entered, or the per-field messages explaining why there is
 * none. The rate is always automatic: the screen is online only, so the server freezes the current one.
 */
export function buildCardExpenseRequest(
  values: CardExpenseFormValues,
  context: CardExpenseRequestContext,
): CardExpenseRequestResult {
  const { categories, timeZone, locale, now } = context;
  const fields: CardExpenseFieldErrors = {};

  const currency = toCurrency(values.currency);
  if (currency === undefined) fields.currency = 'creditCards.expense.errors.currencyRequired';

  const category = categories.find((item) => item.id === values.categoryId && !item.archived);
  if (category === undefined) fields.category = 'movements.errors.categoryRequired';

  const amount = parseAmountField(values.amount, locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  let occurredAt: string | undefined;
  if (!LOCAL_DATE_TIME.test(values.occurredAt)) {
    fields.occurredAt = 'movements.errors.dateInvalid';
  } else {
    const instant = zonedLocalToInstant(values.occurredAt, timeZone);
    if (instant === null) fields.occurredAt = 'movements.errors.dateSkipped';
    else if (dateInTimeZone(instant, timeZone) > todayInTimeZone(now, timeZone)) {
      fields.occurredAt = 'errors.movementDateInFuture';
    } else if (!occurredAtSchema.safeParse(instant.toISOString()).success) {
      fields.occurredAt = 'movements.errors.dateInvalid';
    } else occurredAt = instant.toISOString();
  }

  const note = movementNoteSchema.safeParse(values.note);
  if (!note.success) {
    fields.note = CONTROL_OR_FORMAT.test(values.note)
      ? 'movements.errors.noteInvalidCharacters'
      : 'movements.errors.noteTooLong';
  }

  if (
    Object.keys(fields).length > 0 ||
    currency === undefined ||
    category === undefined ||
    amount.amount === undefined ||
    occurredAt === undefined ||
    !note.success
  ) {
    return { fields };
  }

  return {
    request: {
      currency,
      categoryId: category.id,
      amount: formatMinorUnitsString(amount.amount),
      occurredAt,
      ...(note.data === undefined ? {} : { note: note.data }),
      rate: { source: 'automatic' },
    },
  };
}
