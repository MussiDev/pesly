import {
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  MOVEMENT_TYPES,
  dateInTimeZone,
  formatMinorUnitsString,
  movementNoteSchema,
  occurredAtSchema,
  parseAmountInput,
  parseRateInput,
  todayInTimeZone,
  zonedLocalToInstant,
  type MovementType,
} from '@pesly/shared';
import type { CreateMovementInput } from '@/lib/api-client';
import type { MovementFormValues } from './components/movement-form';
import type { MovementFieldMessage, MovementFieldName } from './movement-form-errors';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

type FieldErrors = Partial<Record<MovementFieldName, MovementFieldMessage>>;

export interface MovementRequestAccount {
  id: string;
  currency: string;
  archived: boolean;
}

export interface MovementRequestCategory {
  id: string;
  kind: MovementType;
  archived: boolean;
}

export interface MovementRequestContext {
  accounts: readonly MovementRequestAccount[];
  categories: readonly MovementRequestCategory[];
  timeZone: string;
  locale: string;
  now: Date;
  /** The stored default rate formatted for the locale; empty when there is none. */
  defaultRate: string;
}

export type MovementRequestResult =
  | { request: CreateMovementInput; fields?: undefined }
  | { request?: undefined; fields: FieldErrors };

function toMovementType(value: string): MovementType | undefined {
  return MOVEMENT_TYPES.find((type) => type === value);
}

/** Positive, up to 2 decimals (the parser), at most 10^15 minor units: the message or the amount. */
function parseAmountField(
  text: string,
  locale: string,
): { amount: bigint; message?: undefined } | { amount?: undefined; message: MovementFieldMessage } {
  const amount = parseAmountInput(text, locale);
  if (amount === null) return { message: 'movements.errors.amountInvalid' };
  if (amount <= 0n) return { message: 'movements.errors.amountNotPositive' };
  if (amount > MOVEMENT_AMOUNT_MAX_MINOR_UNITS) {
    return { message: 'movements.errors.amountOutOfRange' };
  }
  return { amount };
}

/**
 * The request to send for what the user entered, or the per-field messages explaining why there is
 * none. Nothing is sent while any field is invalid. The rate of an exchange is never built: the API
 * computes and freezes it.
 */
export function buildMovementRequest(
  values: MovementFormValues,
  context: MovementRequestContext,
): MovementRequestResult {
  const { accounts, categories, timeZone, locale, now } = context;
  const type = toMovementType(values.type);
  if (type === undefined) return { fields: { type: 'movements.errors.typeInvalid' } };
  const categorized = type === 'expense' || type === 'income';
  const fields: FieldErrors = {};

  const account = accounts.find((item) => item.id === values.accountId && !item.archived);
  if (account === undefined) fields.account = 'movements.errors.accountRequired';

  let destinationId: string | undefined;
  if (!categorized) {
    const destination = accounts.find(
      (item) => item.id === values.destinationAccountId && !item.archived,
    );
    if (destination === undefined)
      fields.destinationAccount = 'movements.errors.destinationRequired';
    else if (account !== undefined) {
      if (destination.id === account.id) fields.destinationAccount = 'errors.movementSameAccount';
      else if (type === 'transfer' && destination.currency !== account.currency) {
        fields.destinationAccount = 'errors.movementCurrencyMismatch';
      } else if (type === 'exchange' && destination.currency === account.currency) {
        fields.destinationAccount = 'errors.exchangeSameCurrency';
      } else destinationId = destination.id;
    }
  }

  const category = categorized
    ? categories.find(
        (item) => item.id === values.categoryId && !item.archived && item.kind === type,
      )
    : undefined;
  if (categorized && category === undefined) fields.category = 'movements.errors.categoryRequired';

  const amount = parseAmountField(values.amount, locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  let destinationAmount: bigint | undefined;
  if (type === 'exchange') {
    const parsed = parseAmountField(values.destinationAmount ?? '', locale);
    if (parsed.message !== undefined) fields.destinationAmount = parsed.message;
    else destinationAmount = parsed.amount;
  }

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

  let rate: Extract<CreateMovementInput, { type: 'expense' }>['rate'] | undefined;
  if (categorized) {
    if (!values.rateEdited && context.defaultRate !== '') {
      rate = { source: 'automatic' };
    } else if (values.rate.trim() === '') {
      fields.rate = 'movements.errors.rateRequired';
    } else {
      const scaled = parseRateInput(values.rate, locale);
      if (scaled === null) fields.rate = 'movements.errors.rateInvalid';
      else rate = { source: 'manual', value: scaled.toString() };
    }
  }

  const note = movementNoteSchema.safeParse(values.note);
  if (!note.success) {
    fields.note = CONTROL_OR_FORMAT.test(values.note)
      ? 'movements.errors.noteInvalidCharacters'
      : 'movements.errors.noteTooLong';
  }

  if (
    Object.keys(fields).length > 0 ||
    account === undefined ||
    amount.amount === undefined ||
    occurredAt === undefined ||
    !note.success
  ) {
    return { fields };
  }

  const common = {
    accountId: account.id,
    amount: formatMinorUnitsString(amount.amount),
    occurredAt,
    ...(note.data === undefined ? {} : { note: note.data }),
  };

  if (categorized) {
    if (category === undefined || rate === undefined) return { fields };
    return { request: { ...common, type, categoryId: category.id, rate } };
  }
  if (destinationId === undefined) return { fields };
  if (type === 'transfer') {
    return { request: { ...common, type, destinationAccountId: destinationId } };
  }
  if (destinationAmount === undefined) return { fields };
  return {
    request: {
      ...common,
      type,
      destinationAccountId: destinationId,
      destinationAmount: formatMinorUnitsString(destinationAmount),
    },
  };
}
