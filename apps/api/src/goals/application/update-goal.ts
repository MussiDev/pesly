import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { assertGoalAmount, assertGoalName } from '../domain/goal';
import type { GoalChanges } from './ports/goal-repository';
import { viewOf, type GoalDependencies, type GoalView } from './goal-view';

export class UpdateGoal {
  constructor(private readonly deps: GoalDependencies) {}

  /**
   * Only name, target amount and target date change; currency and link never do. Lowering the
   * target below the progress is allowed and makes the goal reached.
   */
  async execute(scope: AccessScope<'write'>, id: string, changes: GoalChanges): Promise<GoalView> {
    if (changes.name !== undefined) assertGoalName(changes.name);
    if (changes.targetAmount !== undefined) {
      assertGoalAmount(changes.targetAmount, 'body.targetAmount');
    }
    const goal = notFoundUnlessAllowed(await this.deps.goals.update(scope, id, changes));
    return viewOf(this.deps, scope, goal);
  }
}
