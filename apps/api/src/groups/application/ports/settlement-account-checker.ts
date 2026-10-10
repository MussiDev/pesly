import type { AccountCurrency } from '@pesly/shared';

export interface SettlementAccountCheck {
  userId: string;
  accountId: string;
  currency: AccountCurrency;
}

/** Groups-side port over `accounts` (spec D5, D18). */
export interface SettlementAccountChecker {
  /**
   * True when the account is one of the user's own, not archived, in the given currency. An
   * account of someone else answers false like a missing one, so it cannot be probed.
   */
  isUsable(check: SettlementAccountCheck): Promise<boolean>;
}
