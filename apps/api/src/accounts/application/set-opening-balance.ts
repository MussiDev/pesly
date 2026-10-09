import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import { withSingleBalance } from './account-balances';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface SetOpeningBalanceDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

export class SetOpeningBalance {
  constructor(private readonly deps: SetOpeningBalanceDependencies) {}

  /**
   * Like a rename, allowed on archived and card-linked accounts: the module has no rule for either.
   * Only the stored opening balance changes; the balance is derived on read, so it moves by the
   * difference. The range is validated at the edge by `openingBalanceSchema`.
   */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    openingBalance: bigint,
  ): Promise<AccountWithBalance> {
    const account = notFoundUnlessAllowed(
      await this.deps.accounts.setOpeningBalance(scope, id, openingBalance),
    );
    return withSingleBalance(this.deps.movements, account);
  }
}
