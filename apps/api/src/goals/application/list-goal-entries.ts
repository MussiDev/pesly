import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { GoalEntry } from '../domain/goal';
import type { GoalDependencies } from './goal-view';

export const DEFAULT_ENTRY_LIMIT = 50;
export const MAX_ENTRY_LIMIT = 100;

export class ListGoalEntries {
  constructor(private readonly deps: Pick<GoalDependencies, 'goals'>) {}

  /** Newest first; a missing or foreign goal is `ResourceNotFound`. */
  async execute(
    scope: AccessScope,
    goalId: string,
    limit: number = DEFAULT_ENTRY_LIMIT,
  ): Promise<GoalEntry[]> {
    const bounded = Math.min(Math.max(limit, 1), MAX_ENTRY_LIMIT);
    return notFoundUnlessAllowed(await this.deps.goals.listEntries(scope, goalId, bounded));
  }
}
