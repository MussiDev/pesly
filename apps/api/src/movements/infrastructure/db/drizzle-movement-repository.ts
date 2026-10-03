import { and, count, eq, sql } from 'drizzle-orm';
import type { MovementRepository } from '../../application/ports/movement-repository';
import type { Movement, NewMovement } from '../../domain/movement';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import { ResourceNotFound } from '../../../shared/access/not-found-unless-allowed';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import { movements } from './schema';

const ACCOUNT_KEY = 'movements_account_owner_fk';
const CATEGORY_KEY = 'movements_category_owner_kind_fk';
const DESTINATION_KEY = 'movements_destination_owner_fk';
const NOT_FOUND_KEYS: readonly (string | undefined)[] = [
  ACCOUNT_KEY,
  CATEGORY_KEY,
  DESTINATION_KEY,
];

const columns = {
  id: movements.id,
  ownerId: movements.ownerId,
  type: movements.type,
  accountId: movements.accountId,
  categoryId: movements.categoryId,
  amount: movements.amount,
  occurredAt: movements.occurredAt,
  note: movements.note,
  rate: movements.rate,
  rateSource: movements.rateSource,
  rateType: movements.rateType,
  destinationAccountId: movements.destinationAccountId,
  destinationAmount: movements.destinationAmount,
  createdAt: movements.createdAt,
};

/** A row as the database returns it: every column of the union, the optional ones nullable. */
export type MovementRow = Pick<typeof movements.$inferSelect, keyof typeof columns>;

const inScope = (scope: AccessScope) => scopedTo(scope, { owner: movements.ownerId });

/**
 * An account, destination or category that vanished between the read and the insert is a
 * not-found, never a 500. Any other violation (the key to users, a check) is rethrown as it is.
 */
function asNotFound(error: unknown): unknown {
  const key = violatedConstraint(error, '23503');
  return NOT_FOUND_KEYS.includes(key) ? new ResourceNotFound() : error;
}

function inconsistent(row: MovementRow): Error {
  // The id is enough to find the row; no amount or account goes into the message.
  return new Error(`Movement ${row.id} has an inconsistent shape for its type "${row.type}"`);
}

/**
 * Maps a stored row to the variant of its type. The shape check keeps the database consistent, so
 * a row that does not fit its type is a programming error (a missed migration), never returned.
 */
export function toMovement(row: MovementRow): Movement {
  const base = {
    id: row.id,
    ownerId: row.ownerId,
    accountId: row.accountId,
    amount: row.amount,
    occurredAt: row.occurredAt,
    note: row.note,
    createdAt: row.createdAt,
  };
  switch (row.type) {
    case 'expense':
    case 'income': {
      if (
        row.categoryId === null ||
        row.rate === null ||
        row.rateSource === null ||
        row.rateSource === 'implied' ||
        row.destinationAccountId !== null ||
        row.destinationAmount !== null
      ) {
        throw inconsistent(row);
      }
      return {
        ...base,
        type: row.type,
        categoryId: row.categoryId,
        rate: row.rate,
        rateSource: row.rateSource,
        rateType: row.rateType,
      };
    }
    case 'transfer': {
      if (
        row.categoryId !== null ||
        row.destinationAccountId === null ||
        row.destinationAmount === null ||
        row.rate !== null ||
        row.rateSource !== null ||
        row.rateType !== null
      ) {
        throw inconsistent(row);
      }
      return {
        ...base,
        type: 'transfer',
        destinationAccountId: row.destinationAccountId,
        destinationAmount: row.destinationAmount,
      };
    }
    case 'exchange': {
      if (
        row.categoryId !== null ||
        row.destinationAccountId === null ||
        row.destinationAmount === null ||
        row.rate === null ||
        row.rateSource !== 'implied' ||
        row.rateType !== null
      ) {
        throw inconsistent(row);
      }
      return {
        ...base,
        type: 'exchange',
        destinationAccountId: row.destinationAccountId,
        destinationAmount: row.destinationAmount,
        rate: row.rate,
        rateSource: 'implied',
        rateType: null,
      };
    }
  }
}

/** The list statement, exposed so a test can ask the planner about it. */
export function listMovementsQuery(
  db: Database,
  scope: AccessScope,
  options: { limit: number; offset: number },
) {
  return (
    db
      .select(columns)
      .from(movements)
      .where(inScope(scope))
      // Same direction and null placement as movements_owner_date_idx, so the planner needs no sort.
      .orderBy(sql`${movements.occurredAt} desc nulls last`, sql`${movements.id} desc nulls last`)
      .limit(options.limit)
      .offset(options.offset)
  );
}

export class DrizzleMovementRepository implements MovementRepository {
  constructor(private readonly db: Database) {}

  async insert(scope: AccessScope<'write'>, data: NewMovement): Promise<Movement> {
    // A note that is empty after trimming carries no information.
    const note = data.note === null || data.note.trim() === '' ? null : data.note;
    try {
      const [row] = await this.db
        .insert(movements)
        // Fields are picked one by one: a loosely typed caller cannot smuggle id or timestamps.
        .values({
          ownerId: scope.userId,
          type: data.type,
          accountId: data.accountId,
          categoryId: 'categoryId' in data ? data.categoryId : null,
          amount: data.amount,
          occurredAt: data.occurredAt,
          note,
          rate: 'rate' in data ? data.rate : null,
          rateSource: 'rateSource' in data ? data.rateSource : null,
          rateType: 'rateType' in data ? data.rateType : null,
          destinationAccountId: 'destinationAccountId' in data ? data.destinationAccountId : null,
          destinationAmount: 'destinationAmount' in data ? data.destinationAmount : null,
        })
        .returning(columns);
      if (!row) throw new Error('Inserting a movement returned no row');
      return toMovement(row);
    } catch (error) {
      throw asNotFound(error);
    }
  }

  async list(
    scope: AccessScope,
    options: { limit: number; offset: number },
  ): Promise<{ items: Movement[]; total: number }> {
    const where = inScope(scope);
    const rows = await listMovementsQuery(this.db, scope, options);
    const [totalRow] = await this.db.select({ total: count() }).from(movements).where(where);
    return { items: rows.map(toMovement), total: totalRow?.total ?? 0 };
  }

  async findById(scope: AccessScope, id: string): Promise<Movement | null> {
    const [row] = await this.db
      .select(columns)
      .from(movements)
      .where(and(eq(movements.id, id), inScope(scope)))
      .limit(1);
    return row ? toMovement(row) : null;
  }
}
