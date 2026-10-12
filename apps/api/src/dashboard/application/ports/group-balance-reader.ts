import type { BalanceSourcesByCurrency } from '../../../groups';
import type { AccessScope } from '../../../shared/access';

/** The caller's member row in one group and the sources of its balance (spec 04e formula). */
export interface GroupBalanceSource {
  groupId: string;
  memberId: string;
  /** Holds only the caller's member: paid, shares and signed settlement legs per currency. */
  sources: BalanceSourcesByCurrency;
}

export interface GroupBalanceReader {
  /** Every group the caller is or was a member of, one statement for all of them. */
  sourcesOf(scope: AccessScope): Promise<GroupBalanceSource[]>;
}
