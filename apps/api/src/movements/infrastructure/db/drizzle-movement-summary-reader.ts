import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { CATEGORIZED_MOVEMENT_TYPES } from '@pesly/shared';
import type {
  MovementSummaryReader,
  MovementSummaryRow,
} from '../../application/ports/movement-summary-reader';
import type { MovementFilters } from '../../domain/movement';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import { movementConditions } from './drizzle-movement-filters';
import { accounts } from './foreign-relations';
import { movements } from './schema';

export class DrizzleMovementSummaryReader implements MovementSummaryReader {
  constructor(private readonly db: Database) {}

  async summarize(
    scope: AccessScope<'read'>,
    filters: MovementFilters,
  ): Promise<MovementSummaryRow[]> {
    const rows = await this.db
      .select({
        categoryId: movements.categoryId,
        currency: accounts.currency,
        type: movements.type,
        // Text keeps the exact sum: a numeric past 2^53 would lose digits as a JavaScript number.
        amount: sql<string>`sum(${movements.amount})::text`,
        count: count(),
      })
      .from(movements)
      .innerJoin(
        accounts,
        and(eq(accounts.id, movements.accountId), eq(accounts.ownerId, movements.ownerId)),
      )
      .where(
        and(
          movementConditions(scope, filters),
          inArray(movements.type, [...CATEGORIZED_MOVEMENT_TYPES]),
        ),
      )
      .groupBy(movements.categoryId, accounts.currency, movements.type);
    return rows.map((row) => {
      if (row.type !== 'expense' && row.type !== 'income') {
        throw new Error(`Summary row of unexpected type "${row.type}"`);
      }
      return {
        categoryId: row.categoryId,
        currency: row.currency,
        type: row.type,
        amount: BigInt(row.amount),
        count: row.count,
      };
    });
  }
}
