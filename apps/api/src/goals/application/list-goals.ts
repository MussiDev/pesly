import type { AccessScope } from '../../shared/access';
import { viewsOf, type GoalDependencies, type GoalView } from './goal-view';

export class ListGoals {
  constructor(private readonly deps: GoalDependencies) {}

  /** Only the scope's goals, oldest first; progress is read once for the whole list. */
  async execute(scope: AccessScope): Promise<GoalView[]> {
    return viewsOf(this.deps, scope, await this.deps.goals.list(scope));
  }
}
