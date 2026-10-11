import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { GoalLinkedToAccount } from '../domain/errors';
import { assertGoalAmount, type GoalEntry, type GoalEntryKind } from '../domain/goal';
import { buildGoalView, todayFor, type GoalDependencies, type GoalView } from './goal-view';

export interface RecordGoalEntryInput {
  kind: GoalEntryKind;
  amount: bigint;
}

export class RecordGoalEntry {
  constructor(private readonly deps: GoalDependencies) {}

  /**
   * A linked goal refuses entries (`GoalLinkedToAccount`). The repository applies the withdrawal
   * and size rules atomically under a row lock, so the progress it returns is the one it checked.
   */
  async execute(
    scope: AccessScope<'write'>,
    goalId: string,
    input: RecordGoalEntryInput,
  ): Promise<{ entry: GoalEntry; goal: GoalView }> {
    assertGoalAmount(input.amount, 'body.amount');
    const goal = notFoundUnlessAllowed(await this.deps.goals.findById(scope, goalId));
    if (goal.accountId !== null) throw new GoalLinkedToAccount();
    const recorded = notFoundUnlessAllowed(
      await this.deps.goals.recordEntry(scope, goalId, input.kind, input.amount),
    );
    const today = await todayFor(this.deps, scope.userId);
    return { entry: recorded.entry, goal: buildGoalView(goal, recorded.progress, today) };
  }
}
