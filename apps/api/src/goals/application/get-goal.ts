import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { viewOf, type GoalDependencies, type GoalView } from './goal-view';

export class GetGoal {
  constructor(private readonly deps: GoalDependencies) {}

  /** Missing or foreign: `ResourceNotFound`. */
  async execute(scope: AccessScope, id: string): Promise<GoalView> {
    const goal = notFoundUnlessAllowed(await this.deps.goals.findById(scope, id));
    return viewOf(this.deps, scope, goal);
  }
}
