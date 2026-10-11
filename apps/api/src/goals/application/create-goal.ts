import type { AccountCurrency } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { GoalAccountArchived, GoalAccountCurrencyMismatch } from '../domain/errors';
import { assertGoalAmount, assertGoalName } from '../domain/goal';
import { viewOf, type GoalDependencies, type GoalView } from './goal-view';

export interface CreateGoalInput {
  name: string;
  targetAmount: bigint;
  currency: AccountCurrency;
  targetDate?: string | undefined;
  accountId?: string | undefined;
}

export class CreateGoal {
  constructor(private readonly deps: GoalDependencies) {}

  /**
   * A missing or foreign account is `ResourceNotFound` and creates nothing; another currency is
   * `GoalAccountCurrencyMismatch`, an archived account `GoalAccountArchived`. The repository
   * enforces the per-user limit (`GoalLimitReached`) atomically.
   */
  async execute(scope: AccessScope<'write'>, input: CreateGoalInput): Promise<GoalView> {
    assertGoalName(input.name);
    assertGoalAmount(input.targetAmount, 'body.targetAmount');
    if (input.accountId !== undefined) {
      const account = notFoundUnlessAllowed(
        await this.deps.accounts.findLinkable(scope, input.accountId),
      );
      if (account.currency !== input.currency) throw new GoalAccountCurrencyMismatch();
      if (account.archived) throw new GoalAccountArchived();
    }
    const goal = await this.deps.goals.create(scope, {
      name: input.name,
      targetAmount: input.targetAmount,
      currency: input.currency,
      targetDate: input.targetDate ?? null,
      accountId: input.accountId ?? null,
    });
    return viewOf(this.deps, scope, goal);
  }
}
