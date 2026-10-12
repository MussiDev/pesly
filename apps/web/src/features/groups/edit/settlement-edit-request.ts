import {
  formatMinorUnits,
  formatMinorUnitsString,
  instantToZonedLocal,
  type SettlementResponse,
} from '@pesly/shared';
import { parseAmountField } from '@/features/movements/movement-request';
import { parseLocalDateTime } from '../settlements/settlement-request';
import type { SettlementEditRequest } from '@/lib/local-store/group-queue';

const ERR = 'groups.edit.settlement.errors';

export interface SettlementEditValues {
  /** Typed in the locale notation. */
  amount: string;
  /** `YYYY-MM-DDTHH:mm`, the wall-clock time in the user's time zone. */
  occurredAt: string;
}

export interface SettlementEditContext {
  timeZone: string;
  locale: string;
  now: Date;
}

export type SettlementEditFieldErrors = Partial<Record<'amount' | 'occurredAt', string>>;

export type SettlementEditResult =
  | { request: SettlementEditRequest; fields?: undefined }
  | { request?: undefined; fields: SettlementEditFieldErrors };

function language(locale: string): 'es' | 'en' {
  return locale.startsWith('es') ? 'es' : 'en';
}

/** The fields start from the queued request when there is one, else from the loaded record. */
export function settlementEditValues(
  settlement: Pick<SettlementResponse, 'amount' | 'occurredAt'>,
  queued: SettlementEditRequest | undefined,
  context: Pick<SettlementEditContext, 'timeZone' | 'locale'>,
): SettlementEditValues {
  const amount = BigInt(queued?.amount ?? settlement.amount);
  const occurredAt = queued?.occurredAt ?? settlement.occurredAt;
  return {
    amount: formatMinorUnits(amount, language(context.locale)),
    occurredAt: instantToZonedLocal(new Date(occurredAt), context.timeZone),
  };
}

/**
 * The partial update for what was typed: only the fields that differ from the loaded record, or a
 * field error when nothing changed. Nothing is built while any field is invalid.
 */
export function buildSettlementEditRequest(
  values: SettlementEditValues,
  settlement: Pick<SettlementResponse, 'amount' | 'occurredAt'>,
  context: SettlementEditContext,
): SettlementEditResult {
  const fields: SettlementEditFieldErrors = {};

  const amount = parseAmountField(values.amount, context.locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  const date = parseLocalDateTime(values.occurredAt, context.timeZone, context.now);
  if (date.error !== undefined) fields.occurredAt = `groups.settlement.errors.${date.error}`;

  if (
    Object.keys(fields).length > 0 ||
    amount.amount === undefined ||
    date.occurredAt === undefined
  ) {
    return { fields };
  }

  const request: SettlementEditRequest = {};
  if (amount.amount !== BigInt(settlement.amount)) {
    request.amount = formatMinorUnitsString(amount.amount);
  }
  const loadedLocal = instantToZonedLocal(new Date(settlement.occurredAt), context.timeZone);
  if (values.occurredAt !== loadedLocal) request.occurredAt = date.occurredAt;

  if (request.amount === undefined && request.occurredAt === undefined) {
    return { fields: { amount: `${ERR}.nothingChanged` } };
  }
  return { request };
}
