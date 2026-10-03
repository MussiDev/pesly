import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { MovementFilters } from '../../domain/movement';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import { categories } from './foreign-relations';
import { movements } from './schema';
import { movementTags, tags } from './tags-schema';

/**
 * The conditions of one list statement: the owner scope plus every present filter, all ANDed.
 * The subqueries on `categories`, `movement_tags` and `tags` apply the scope on their own owner
 * column, so a foreign id or tag name matches nothing. Every value is a bound parameter.
 */
export function movementConditions(scope: AccessScope, filters: MovementFilters): SQL {
  const conditions: SQL[] = [scopedTo(scope, { owner: movements.ownerId })];
  if (filters.accountId !== undefined) conditions.push(eq(movements.accountId, filters.accountId));
  if (filters.type !== undefined) conditions.push(eq(movements.type, filters.type));
  if (filters.occurredFrom !== undefined) {
    conditions.push(gte(movements.occurredAt, filters.occurredFrom));
  }
  if (filters.occurredBefore !== undefined) {
    conditions.push(lt(movements.occurredAt, filters.occurredBefore));
  }
  if (filters.categoryId !== undefined) {
    // Categories have one level, so the parent and its direct children are the whole set.
    conditions.push(sql`${movements.categoryId} in (
      select ${categories.id} from ${categories}
      where ${scopedTo(scope, { owner: categories.ownerId })}
        and (${categories.id} = ${filters.categoryId} or ${categories.parentId} = ${filters.categoryId})
    )`);
  }
  if (filters.tag !== undefined) {
    conditions.push(sql`${movements.id} in (
      select ${movementTags.movementId} from ${movementTags}
      where ${scopedTo(scope, { owner: movementTags.ownerId })}
        and ${movementTags.tagId} in (
          select ${tags.id} from ${tags}
          where ${scopedTo(scope, { owner: tags.ownerId })}
            and lower(${tags.name}) = lower(${filters.tag})
        )
    )`);
  }
  return and(...conditions) ?? conditions[0] ?? sql`true`;
}
