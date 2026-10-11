import { DrizzleAccountLookup } from '../../../movements/infrastructure/db/drizzle-account-lookup';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import type {
  SettlementAccountCheck,
  SettlementAccountChecker,
} from '../../application/ports/settlement-account-checker';

// The account is the caller's own, so it is read with a plain owner scope; the deny-all reader
// keeps group read access out of it.
const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

function readScope(userId: string): Promise<AccessScope<'read'>> {
  return policy.scopeFor({ userId, sessionId: 'group-settlement', emailVerified: true }, 'read');
}

/** Spec D5: one of the caller's own accounts, not archived, in the cash currency. */
export class DrizzleSettlementAccountChecker implements SettlementAccountChecker {
  constructor(private readonly db: Database) {}

  async isUsable(check: SettlementAccountCheck): Promise<boolean> {
    const scope = await readScope(check.userId);
    const account = await new DrizzleAccountLookup(this.db).find(scope, check.accountId);
    return account !== null && !account.archived && account.currency === check.currency;
  }
}
