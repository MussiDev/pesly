import {
  addExact,
  formatMinorUnitsString,
  parseAmountInput,
  setAccountBalanceRequestSchema,
  type SetAccountBalanceRequest,
} from '@pesly/shared';

export type SetBalanceFieldError =
  | {
      field: 'balance';
      message: 'accounts.errors.amountInvalid' | 'accounts.errors.amountOutOfRange';
    }
  | { field: 'note'; message: 'accounts.setBalance.errors.noteInvalid' }
  | { field: 'code'; message: 'errors.secondFactorCodeFormat' };

export type SetBalanceRequestResult =
  | { request: SetAccountBalanceRequest; error?: undefined }
  | { request?: undefined; error: SetBalanceFieldError };

/** What the account would change by: `target - current`, as the API will compute it. */
export function balanceDifference(current: bigint, target: bigint): bigint {
  return addExact(target, -current);
}

export interface SetBalanceInput {
  /** The typed target, untouched. */
  text: string;
  locale: string;
  note?: string | undefined;
  /** Only when the user has 2FA on; `undefined` means no code is asked. */
  code?: string | undefined;
}

/**
 * The request for what was typed, or the field and catalog key explaining why there is none. An
 * empty target is an error: it would otherwise silently mean zero. Parsing goes through the shared
 * schema, so the limits are the API's.
 */
export function buildSetBalanceRequest(input: SetBalanceInput): SetBalanceRequestResult {
  const minorUnits = input.text.trim() === '' ? null : parseAmountInput(input.text, input.locale);
  if (minorUnits === null) {
    return { error: { field: 'balance', message: 'accounts.errors.amountInvalid' } };
  }
  const parsed = setAccountBalanceRequestSchema.safeParse({
    balance: formatMinorUnitsString(minorUnits),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.code === undefined ? {} : { secondFactorCode: input.code }),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === 'note') {
      return { error: { field: 'note', message: 'accounts.setBalance.errors.noteInvalid' } };
    }
    if (field === 'secondFactorCode') {
      return { error: { field: 'code', message: 'errors.secondFactorCodeFormat' } };
    }
    return { error: { field: 'balance', message: 'accounts.errors.amountOutOfRange' } };
  }
  return { request: parsed.data };
}
