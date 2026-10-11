import type { AccountCurrency } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';

export interface LinkableAccount {
  id: string;
  currency: AccountCurrency;
  archived: boolean;
}

/** Reads accounts of the scope only; another user's account is indistinguishable from a missing one. */
export interface AccountBalances {
  /** `null` when the account is missing or not in scope. */
  findLinkable(scope: AccessScope, accountId: string): Promise<LinkableAccount | null>;
  /** Opening balance plus movement sums, per id; ids outside the scope are absent from the map. */
  balancesOf(scope: AccessScope, accountIds: readonly string[]): Promise<Map<string, bigint>>;
}
