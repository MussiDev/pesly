import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { MovementRepository } from '../../application/ports/movement-repository';
import type { Movement, MovementFilters, NewMovement } from '../../domain/movement';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import { ResourceNotFound } from '../../../shared/access/not-found-unless-allowed';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import { movementConditions } from './drizzle-movement-filters';
import { movements } from './schema';
import { movementTags, tags } from './tags-schema';

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

/** Runs on the connection or on a transaction of it. */
type Executor = Pick<Database, 'select' | 'insert' | 'execute'>;

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
export function toMovement(row: MovementRow, tags: readonly string[] = []): Movement {
  const base = {
    id: row.id,
    ownerId: row.ownerId,
    accountId: row.accountId,
    amount: row.amount,
    occurredAt: row.occurredAt,
    note: row.note,
    tags: [...tags],
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
  db: Pick<Database, 'select'>,
  scope: AccessScope,
  options: { limit: number; offset: number; filters: MovementFilters },
) {
  return (
    db
      .select(columns)
      .from(movements)
      .where(movementConditions(scope, options.filters))
      // Same direction and null placement as movements_owner_date_idx, so the planner needs no sort.
      .orderBy(sql`${movements.occurredAt} desc nulls last`, sql`${movements.id} desc nulls last`)
      .limit(options.limit)
      .offset(options.offset)
  );
}

/**
 * The tag names of the given movements in stored order, by one statement scoped on both tables.
 * The ids are never trusted as proof of ownership: a movement of another owner yields nothing.
 */
export async function loadTagsOf(
  db: Pick<Database, 'select'>,
  scope: AccessScope,
  movementIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byMovement = new Map<string, string[]>();
  if (movementIds.length === 0) return byMovement;
  const rows = await db
    .select({ movementId: movementTags.movementId, name: tags.name })
    .from(movementTags)
    .innerJoin(tags, and(eq(tags.id, movementTags.tagId), eq(tags.ownerId, movementTags.ownerId)))
    .where(
      and(
        scopedTo(scope, { owner: movementTags.ownerId }),
        scopedTo(scope, { owner: tags.ownerId }),
        inArray(movementTags.movementId, [...movementIds]),
      ),
    )
    .orderBy(asc(movementTags.movementId), asc(movementTags.position));
  for (const row of rows) {
    const names = byMovement.get(row.movementId);
    if (names) names.push(row.name);
    else byMovement.set(row.movementId, [row.name]);
  }
  return byMovement;
}

/**
 * Stores the tags of a movement: creates the missing ones, then links them in the given order.
 * Returns the stored spellings. Runs inside the movement's transaction.
 */
async function linkTags(
  tx: Executor,
  ownerId: string,
  movementId: string,
  names: readonly string[],
): Promise<string[]> {
  if (names.length === 0) return [];
  const rows = sql.join(
    names.map((name) => sql`(${ownerId}, ${name})`),
    sql`, `,
  );
  await tx.execute(
    sql`insert into ${tags} (${sql.identifier('owner_id')}, ${sql.identifier('name')}) values ${rows}
        on conflict (owner_id, lower(name)) do nothing`,
  );
  const given = sql.join(
    names.map((name, index) => sql`(${name}::text, ${index + 1}::int)`),
    sql`, `,
  );
  const resolved = await tx.execute<{ id: string; name: string }>(
    sql`select t.id as id, t.name as name
        from (values ${given}) as given(name, ord)
        join ${tags} t on t.owner_id = ${ownerId} and lower(t.name) = lower(given.name)
        order by given.ord`,
  );
  // Two spellings that PostgreSQL folds together resolve to one tag: keep the first.
  const unique = new Map<string, string>();
  for (const row of resolved.rows) if (!unique.has(row.id)) unique.set(row.id, row.name);
  const links = [...unique.keys()].map((tagId, position) => ({
    movementId,
    tagId,
    ownerId,
    position,
  }));
  await tx.insert(movementTags).values(links);
  return [...unique.values()];
}

export class DrizzleMovementRepository implements MovementRepository {
  constructor(private readonly db: Database) {}

  async insert(scope: AccessScope<'write'>, data: NewMovement): Promise<Movement> {
    // A note that is empty after trimming carries no information.
    const note = data.note === null || data.note.trim() === '' ? null : data.note;
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
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
        const stored = await linkTags(tx, scope.userId, row.id, data.tags ?? []);
        return toMovement(row, stored);
      });
    } catch (error) {
      throw asNotFound(error);
    }
  }

  async update(
    scope: AccessScope<'write'>,
    id: string,
    data: NewMovement,
  ): Promise<Movement | null> {
    const note = data.note === null || data.note.trim() === '' ? null : data.note;
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(movements)
          // Same fields as insert, picked one by one; the type is part of the match, never set.
          .set({
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
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(movements.id, id),
              eq(movements.type, data.type),
              scopedTo(scope, { owner: movements.ownerId }),
            ),
          )
          .returning(columns);
        if (!row) return null;
        await tx
          .delete(movementTags)
          .where(
            and(eq(movementTags.movementId, id), scopedTo(scope, { owner: movementTags.ownerId })),
          );
        const stored = await linkTags(tx, scope.userId, id, data.tags ?? []);
        return toMovement(row, stored);
      });
    } catch (error) {
      throw asNotFound(error);
    }
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    // The tag links go with the row through their cascading key.
    const removed = await this.db
      .delete(movements)
      .where(and(eq(movements.id, id), scopedTo(scope, { owner: movements.ownerId })))
      .returning({ id: movements.id });
    return removed.length > 0;
  }

  async list(
    scope: AccessScope,
    options: { limit: number; offset: number; filters: MovementFilters },
  ): Promise<{ items: Movement[]; total: number }> {
    const rows = await listMovementsQuery(this.db, scope, options);
    const [totalRow] = await this.db
      .select({ total: count() })
      .from(movements)
      .where(movementConditions(scope, options.filters));
    const tagsByMovement = await loadTagsOf(
      this.db,
      scope,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => toMovement(row, tagsByMovement.get(row.id))),
      total: totalRow?.total ?? 0,
    };
  }

  async findById(scope: AccessScope, id: string): Promise<Movement | null> {
    const [row] = await this.db
      .select(columns)
      .from(movements)
      .where(and(eq(movements.id, id), scopedTo(scope, { owner: movements.ownerId })))
      .limit(1);
    if (!row) return null;
    const tagsByMovement = await loadTagsOf(this.db, scope, [row.id]);
    return toMovement(row, tagsByMovement.get(row.id));
  }
}
