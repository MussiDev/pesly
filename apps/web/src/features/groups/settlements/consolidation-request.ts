import {
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  RATE_MAX_SCALED,
  accountCurrencySchema,
  convertMinorUnits,
  createSettlementRequestSchema,
  formatMinorUnitsString,
  parseRateInput,
  type AccountCurrency,
  type ConsolidationPreview,
  type CreateSettlementRequest,
} from '@pesly/shared';
import { parseLocalDateTime } from './settlement-request';

export type ConsolidationErrorKey =
  | 'memberRequired'
  | 'sameMember'
  | 'currencyInvalid'
  | 'dateInvalid'
  | 'dateSkipped'
  | 'dateInFuture'
  | 'rateRequired'
  | 'rateInvalid'
  | 'nothingToConsolidate'
  | 'legsInvalid'
  | 'cashOutOfRange';

/** A catalog path under `groups.consolidate.errors`. */
export type ConsolidationFieldMessage = `groups.consolidate.errors.${ConsolidationErrorKey}`;

export type ConsolidationFieldName =
  'memberA' | 'memberB' | 'currency' | 'occurredAt' | 'rate' | 'legs';

export type ConsolidationFieldErrors = Partial<
  Record<ConsolidationFieldName, ConsolidationFieldMessage>
>;

export interface ConsolidationChoice {
  /** The pair in the order that produced the preview legs. */
  memberA: string;
  memberB: string;
  currency: string;
  occurredAt: string;
  /** Null: use the preview's stored rate. A string, even an empty one, is a typed manual rate. */
  rate: string | null;
}

export interface ConsolidationRequestContext {
  memberIds: readonly string[];
  timeZone: string;
  locale: string;
  now: Date;
}

export type ConsolidatedSettlementRequest = Extract<
  CreateSettlementRequest,
  { kind: 'consolidated' }
>;

export type ConsolidationRequestResult =
  | { request: ConsolidatedSettlementRequest; fields?: undefined }
  | { request?: undefined; fields: ConsolidationFieldErrors };

export interface Cash {
  /** The cash in the chosen currency, never negative. */
  amount: bigint;
  /** The cash goes from memberB to memberA instead of from memberA to memberB. */
  swapped: boolean;
}

/**
 * The cash that changes hands, as the API stores it: the leg in the chosen currency plus the other
 * leg converted at `rate`, signed from memberA to memberB; a negative total swaps the parties.
 * Shown before confirming, never sent.
 */
export function cashOf(
  preview: Pick<ConsolidationPreview, 'legs'>,
  currency: AccountCurrency,
  rate: bigint,
): Cash {
  const other: AccountCurrency = currency === 'ARS' ? 'USD' : 'ARS';
  const converted = convertMinorUnits(BigInt(preview.legs[other]), other, rate);
  const cash = BigInt(preview.legs[currency]) + converted;
  return cash < 0n ? { amount: -cash, swapped: true } : { amount: cash, swapped: false };
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/**
 * The consolidated body for a previewed pair, or the catalog path of what is wrong per field. The
 * legs are the preview's, verbatim and in its order; only a typed manual rate is sent as a rate.
 */
export function buildConsolidationRequest(
  preview: ConsolidationPreview,
  choice: ConsolidationChoice,
  context: ConsolidationRequestContext,
): ConsolidationRequestResult {
  const fields: ConsolidationFieldErrors = {};
  const active = new Set(context.memberIds);

  if (!active.has(choice.memberA)) fields.memberA = 'groups.consolidate.errors.memberRequired';
  if (!active.has(choice.memberB)) {
    fields.memberB = 'groups.consolidate.errors.memberRequired';
  } else if (choice.memberA === choice.memberB) {
    fields.memberB = 'groups.consolidate.errors.sameMember';
  }

  const currency = accountCurrencySchema.safeParse(choice.currency);
  if (!currency.success) fields.currency = 'groups.consolidate.errors.currencyInvalid';

  const date = parseLocalDateTime(choice.occurredAt, context.timeZone, context.now);
  if (date.error !== undefined) fields.occurredAt = `groups.consolidate.errors.${date.error}`;

  let manualRate: bigint | undefined;
  let rate: bigint | undefined;
  if (choice.rate !== null) {
    manualRate = parseRateInput(choice.rate, context.locale) ?? undefined;
    if (manualRate === undefined || manualRate < 1n || manualRate > RATE_MAX_SCALED) {
      fields.rate = 'groups.consolidate.errors.rateInvalid';
    } else rate = manualRate;
  } else if (preview.rate === null) {
    fields.rate = 'groups.consolidate.errors.rateRequired';
  } else rate = BigInt(preview.rate);

  if (BigInt(preview.legs.ARS) === 0n || BigInt(preview.legs.USD) === 0n) {
    fields.legs = 'groups.consolidate.errors.nothingToConsolidate';
  }

  if (fields.legs === undefined && currency.success && rate !== undefined) {
    const other: AccountCurrency = currency.data === 'ARS' ? 'USD' : 'ARS';
    const converted = convertMinorUnits(BigInt(preview.legs[other]), other, rate);
    const { amount } = cashOf(preview, currency.data, rate);
    if (
      abs(converted) > MOVEMENT_AMOUNT_MAX_MINOR_UNITS ||
      amount > MOVEMENT_AMOUNT_MAX_MINOR_UNITS
    ) {
      fields.rate = 'groups.consolidate.errors.cashOutOfRange';
    }
  }

  if (Object.keys(fields).length > 0 || !currency.success || date.occurredAt === undefined) {
    return { fields };
  }

  const request: ConsolidatedSettlementRequest = {
    kind: 'consolidated',
    memberIds: [choice.memberA, choice.memberB],
    currency: currency.data,
    occurredAt: date.occurredAt,
    ...(manualRate === undefined ? {} : { rate: formatMinorUnitsString(manualRate) }),
    legs: { ARS: preview.legs.ARS, USD: preview.legs.USD },
  };
  // Last guard: a preview the shared validator refuses (for instance out-of-range legs) is never sent.
  if (!createSettlementRequestSchema.safeParse(request).success) {
    return { fields: { legs: 'groups.consolidate.errors.legsInvalid' } };
  }
  return { request };
}
