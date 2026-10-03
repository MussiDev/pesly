import { MOVEMENT_AMOUNT_MAX_MINOR_UNITS, impliedRate, parseAmountInput } from '@pesly/shared';
import { formatRate } from './format-rate';

/** What the read-only line of an exchange shows; the stored rate is always the API's. */
export type ImpliedRatePreview =
  { kind: 'empty' } | { kind: 'rate'; text: string } | { kind: 'out-of-range' };

/** What the user picked and typed, untouched. */
export interface ImpliedRatePreviewInput {
  accountId: string;
  destinationAccountId: string;
  amount: string;
  destinationAmount: string;
}

interface PreviewAccount {
  id: string;
  currency: string;
}

const EMPTY: ImpliedRatePreview = { kind: 'empty' };

/** A typed amount that the API would accept: positive and at most 10^15 minor units. */
function validAmount(text: string, locale: string): bigint | null {
  const amount = parseAmountInput(text, locale);
  if (amount === null || amount <= 0n || amount > MOVEMENT_AMOUNT_MAX_MINOR_UNITS) return null;
  return amount;
}

/**
 * Display-only implied rate (ARS per USD) of an exchange, with the shared helper the API uses.
 * Empty until the accounts are an ARS/USD pair and both amounts are valid.
 */
export function impliedRatePreview(
  input: ImpliedRatePreviewInput,
  accounts: readonly PreviewAccount[],
  locale: string,
): ImpliedRatePreview {
  const source = accounts.find((account) => account.id === input.accountId);
  const destination = accounts.find((account) => account.id === input.destinationAccountId);
  if (source === undefined || destination === undefined) return EMPTY;

  const amountOut = validAmount(input.amount, locale);
  const amountIn = validAmount(input.destinationAmount, locale);
  if (amountOut === null || amountIn === null) return EMPTY;

  let ars: bigint;
  let usd: bigint;
  if (source.currency === 'ARS' && destination.currency === 'USD') {
    ars = amountOut;
    usd = amountIn;
  } else if (source.currency === 'USD' && destination.currency === 'ARS') {
    ars = amountIn;
    usd = amountOut;
  } else return EMPTY;

  const rate = impliedRate(ars, usd);
  return rate === null
    ? { kind: 'out-of-range' }
    : { kind: 'rate', text: formatRate(rate, locale, 4) };
}
