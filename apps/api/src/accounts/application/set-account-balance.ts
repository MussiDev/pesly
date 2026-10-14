import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { AccountWithBalance } from '../domain/account';
import {
  AccountArchived,
  AccountIsCreditCard,
  BalanceDifferenceOutOfRange,
} from '../domain/errors';
import type { BalanceAdjuster, RecordedAdjustment } from './ports/balance-adjuster';
import type { AccountRepository } from './ports/account-repository';
import type { SecondFactorGate } from './ports/second-factor-gate';

export interface SetAccountBalanceDependencies {
  accounts: AccountRepository;
  adjuster: BalanceAdjuster;
  secondFactor: SecondFactorGate;
}

export interface SetAccountBalanceInput {
  accountId: string;
  /** The balance the account should have now; the difference is computed by the adjuster. */
  balance: bigint;
  note?: string | undefined;
  secondFactorCode?: string | undefined;
}

export interface SetAccountBalanceResult {
  account: AccountWithBalance;
  /** Null when the target already equalled the balance. */
  adjustment: RecordedAdjustment | null;
}

export class SetAccountBalance {
  constructor(private readonly deps: SetAccountBalanceDependencies) {}

  /**
   * The second factor is checked (and its code spent) before anything is written, as in account
   * deletion: a request that then fails on a guard has burned one code. The range of `balance` is
   * validated at the edge by `openingBalanceSchema`.
   */
  async execute(
    scope: AccessScope<'write'>,
    input: SetAccountBalanceInput,
  ): Promise<SetAccountBalanceResult> {
    await this.deps.secondFactor.require(scope.userId, input.secondFactorCode);

    const result = await this.deps.adjuster.adjust({
      ownerId: scope.userId,
      accountId: input.accountId,
      target: input.balance,
      note: input.note ?? null,
    });
    switch (result.status) {
      case 'not_found':
        return notFoundUnlessAllowed<SetAccountBalanceResult>(null);
      case 'credit_card':
        throw new AccountIsCreditCard();
      case 'archived':
        throw new AccountArchived();
      case 'out_of_range':
        throw new BalanceDifferenceOutOfRange();
      case 'adjusted': {
        // Read again through the scoped repository for the stored fields; the balance is the one
        // the adjuster computed under the lock, not a second read that another request could move.
        const account = notFoundUnlessAllowed(
          await this.deps.accounts.findById(scope, input.accountId),
        );
        return {
          account: { ...account, balance: result.balance },
          adjustment: result.adjustment,
        };
      }
    }
  }
}
