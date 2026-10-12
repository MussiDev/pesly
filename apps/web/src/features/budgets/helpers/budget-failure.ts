import type { ApiFailure } from '@/lib/api-client';

export type BudgetFailureKey =
  | { kind: 'not-found' }
  | { kind: 'offline'; key: 'errors.network' }
  | { kind: 'message'; key: `errors.${ApiFailure['messageKey']}` };

/** A missing or foreign budget and a lost connection are told apart; the rest show their own message. */
export function budgetFailureKey(failure: ApiFailure): BudgetFailureKey {
  if (failure.code === 'NOT_FOUND') return { kind: 'not-found' };
  if (failure.code === 'NETWORK') return { kind: 'offline', key: 'errors.network' };
  return { kind: 'message', key: `errors.${failure.messageKey}` };
}

/** The list asked for a month after the current one; it goes back to the current month. */
export function isMonthInFuture(failure: ApiFailure): boolean {
  return failure.code === 'BUDGET_MONTH_IN_FUTURE';
}
