import type { AccessScope } from '../../shared/access';
import { ResourceNotFound } from '../../shared/access';
import { CategoryArchived } from '../../movements/domain/errors';
import { BudgetCategoryKindInvalid } from '../domain/errors';
import { currentMonthStart } from '../domain/month';
import type { BudgetRepository } from './ports/budget-repository';
import type { CategoryReader } from './ports/category-reader';
import type { Clock } from './ports/clock';
import type { UserTimeZone } from './ports/user-time-zone';

export interface BudgetDependencies {
  budgets: BudgetRepository;
  categories: CategoryReader;
  clock: Clock;
  timeZones: UserTimeZone;
}

/** The first day of the caller's current month, in their stored time zone (PRD 01 FR-24). */
export async function monthStartFor(
  deps: Pick<BudgetDependencies, 'clock' | 'timeZones'>,
  userId: string,
): Promise<string> {
  const timeZone = await deps.timeZones.timeZoneOf(userId);
  return currentMonthStart(deps.clock.now(), timeZone);
}

/**
 * Every id must be one of the caller's categories (unknown and foreign are both 404), of kind
 * expense and not archived (D4).
 */
export async function assertBudgetCategories(
  deps: Pick<BudgetDependencies, 'categories'>,
  scope: AccessScope,
  categoryIds: readonly string[],
): Promise<void> {
  const found = await deps.categories.findMany(scope, categoryIds);
  const byId = new Map(found.map((category) => [category.id, category]));
  const refs = categoryIds.map((id) => byId.get(id));
  if (refs.some((ref) => ref === undefined)) throw new ResourceNotFound();
  if (found.some((ref) => ref.kind !== 'expense')) throw new BudgetCategoryKindInvalid();
  if (found.some((ref) => ref.archived)) throw new CategoryArchived();
}
