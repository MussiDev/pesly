import { messageKeyOf, type ApiErrorKey } from '@/lib/api-client';

/** Refusals that sending the same change again cannot fix: the person can only discard it (D11). */
const FINAL_CODES: ReadonlySet<string> = new Set([
  'GROUP_RECORD_FORMER_MEMBER',
  'GROUP_SETTLEMENT_CONSOLIDATED',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'GROUP_EXPENSE_CATEGORY_INVALID',
  'GROUP_SPLIT_PERCENTAGE_INVALID',
  'GROUP_SPLIT_AMOUNT_MISMATCH',
  'GROUP_SPLIT_MEMBER_INVALID',
  'GROUP_SETTLEMENT_MEMBER_INVALID',
]);

/** The catalog path of the message for a rejection code kept on the device. */
export function rejectionMessagePath(code: string): `errors.${ApiErrorKey}` {
  return `errors.${messageKeyOf(code)}`;
}

export function canRetry(code: string): boolean {
  return !FINAL_CODES.has(code);
}
