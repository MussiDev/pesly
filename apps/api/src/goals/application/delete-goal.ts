import { ResourceNotFound, type AccessScope } from '../../shared/access';
import type { GoalDependencies } from './goal-view';

export class DeleteGoal {
  constructor(private readonly deps: Pick<GoalDependencies, 'goals'>) {}

  /** Removes the goal and its entries; no account is read or changed (AC-14). */
  async execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    if (!(await this.deps.goals.delete(scope, id))) throw new ResourceNotFound();
  }
}
