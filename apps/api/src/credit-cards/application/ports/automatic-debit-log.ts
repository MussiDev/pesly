import type { AccessScope } from '../../../shared/access';
import type { Currency } from '../../domain/statement-payment';

/** One automatic debit: a statement (by period) of a card, in one currency. */
export interface AutomaticDebitKey {
  cardId: string;
  period: string;
  currency: Currency;
}

export type AutomaticDebitSkipReason = 'covered' | 'account_unavailable' | 'refused';

/** How a claim ends; a settled key is never retried (spec D1). */
export type AutomaticDebitSettlement =
  | { status: 'recorded'; movementId: string }
  | { status: 'skipped'; reason: AutomaticDebitSkipReason };

export type ClaimResult =
  /** The claim was taken and `settle` ran; `settlement` is `null` when it left the key unclaimed. */
  | { claimed: true; settlement: AutomaticDebitSettlement | null }
  /** Another pass or process had already settled the key; `settle` did not run. */
  | { claimed: false };

/** Exactly-once bookkeeping of automatic debits, one row per (card, period, currency). */
export interface AutomaticDebitLog {
  /** The settled keys of the card, as `settledKey(period, currency)` strings. */
  settledKeys(scope: AccessScope<'write'>, cardId: string): Promise<ReadonlySet<string>>;
  /**
   * Claims `key` under a lock and runs `settle` with the row locked. A settlement is stored with
   * the claim; `null` releases it; a throw rolls the claim back and is rethrown.
   */
  withClaim(
    scope: AccessScope<'write'>,
    key: AutomaticDebitKey,
    settle: () => Promise<AutomaticDebitSettlement | null>,
  ): Promise<ClaimResult>;
}
