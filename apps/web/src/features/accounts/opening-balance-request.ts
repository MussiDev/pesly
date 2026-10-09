import {
  formatMinorUnitsString,
  openingBalanceSchema,
  parseAmountInput,
  type SetOpeningBalanceRequest,
} from '@pesly/shared';

export type OpeningBalanceRequestResult =
  | { request: SetOpeningBalanceRequest; error?: undefined }
  | {
      request?: undefined;
      error: 'accounts.errors.amountInvalid' | 'accounts.errors.amountOutOfRange';
    };

/**
 * The request for the typed amount, or the catalog key explaining why there is none. Unlike
 * account creation, an empty field is an error here: it would otherwise silently mean zero.
 */
export function buildOpeningBalanceRequest(
  text: string,
  locale: string,
): OpeningBalanceRequestResult {
  const minorUnits = text.trim() === '' ? null : parseAmountInput(text, locale);
  if (minorUnits === null) return { error: 'accounts.errors.amountInvalid' };
  const openingBalance = formatMinorUnitsString(minorUnits);
  if (!openingBalanceSchema.safeParse(openingBalance).success) {
    return { error: 'accounts.errors.amountOutOfRange' };
  }
  return { request: { openingBalance } };
}
