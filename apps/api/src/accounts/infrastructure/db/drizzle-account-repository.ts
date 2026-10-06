import { defaultIncludeInAvailable } from '@pesly/shared';
import { and, asc, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type {
  AccountRepository,
  ActiveAccount,
  CreateAccountData,
  ListAccountsOptions,
  SetIncludeInAvailableResult,
} from '../../application/ports/account-repository';
import type { Account } from '../../domain/account';
import { AccountHasMovements, AccountLinkedToCard, AccountNameTaken } from '../../domain/errors';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import { accounts } from './schema';

const NAME_UNIQUE_CONSTRAINT = 'accounts_owner_name_unique';

const columns = {
  id: accounts.id,
  name: accounts.name,
  type: accounts.type,
  currency: accounts.currency,
  openingBalance: accounts.openingBalance,
  includeInAvailable: accounts.includeInAvailable,
  archivedAt: accounts.archivedAt,
  createdAt: accounts.createdAt,
};

const inScope = (scope: AccessScope) => scopedTo(scope, { owner: accounts.ownerId });

/** This row, and only if the scope covers it, in the same statement. */
const scopedRow = (scope: AccessScope, id: string) => and(eq(accounts.id, id), inScope(scope));

function asNameTaken(error: unknown): unknown {
  return violatedConstraint(error, '23505') === NAME_UNIQUE_CONSTRAINT
    ? new AccountNameTaken()
    : error;
}

export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly db: Database) {}

  async create(scope: AccessScope<'write'>, data: CreateAccountData): Promise<Account> {
    try {
      const [row] = await this.db
        .insert(accounts)
        .values({
          ...data,
          // The column has no default: a value must always reach the insert.
          includeInAvailable: data.includeInAvailable ?? defaultIncludeInAvailable(data.type),
          ownerId: scope.userId,
        })
        .returning(columns);
      if (!row) throw new Error('Inserting an account returned no row');
      return row;
    } catch (error) {
      throw asNameTaken(error);
    }
  }

  async findById(scope: AccessScope, id: string): Promise<Account | null> {
    const [row] = await this.db.select(columns).from(accounts).where(scopedRow(scope, id)).limit(1);
    return row ?? null;
  }

  async list(
    scope: AccessScope,
    options: ListAccountsOptions,
  ): Promise<{ items: Account[]; total: number }> {
    const where = and(
      inScope(scope),
      options.archived ? isNotNull(accounts.archivedAt) : isNull(accounts.archivedAt),
    );
    const items = await this.db
      .select(columns)
      .from(accounts)
      .where(where)
      .orderBy(asc(accounts.createdAt), asc(accounts.id))
      .limit(options.limit)
      .offset(options.offset);
    const [totalRow] = await this.db.select({ total: count() }).from(accounts).where(where);
    return { items, total: totalRow?.total ?? 0 };
  }

  async listActive(scope: AccessScope): Promise<ActiveAccount[]> {
    return this.db
      .select({
        id: accounts.id,
        type: accounts.type,
        currency: accounts.currency,
        openingBalance: accounts.openingBalance,
        includeInAvailable: accounts.includeInAvailable,
      })
      .from(accounts)
      .where(and(inScope(scope), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.createdAt), asc(accounts.id));
  }

  async rename(scope: AccessScope<'write'>, id: string, name: string): Promise<Account | null> {
    try {
      const [row] = await this.db
        .update(accounts)
        .set({ name, updatedAt: sql`now()` })
        .where(scopedRow(scope, id))
        .returning(columns);
      return row ?? null;
    } catch (error) {
      throw asNameTaken(error);
    }
  }

  async setArchived(
    scope: AccessScope<'write'>,
    id: string,
    archived: boolean,
  ): Promise<Account | null> {
    // The database clock stamps both columns, so they never depend on app-server clock skew.
    // One statement, idempotent: a row already in the target state keeps archived_at and
    // updated_at, and is still returned.
    const now = sql`now()`;
    const changes = archived
      ? {
          archivedAt: sql<Date>`coalesce(${accounts.archivedAt}, ${now})`,
          updatedAt: sql<Date>`case when ${accounts.archivedAt} is null then ${now} else ${accounts.updatedAt} end`,
        }
      : {
          archivedAt: sql<null>`null`,
          updatedAt: sql<Date>`case when ${accounts.archivedAt} is not null then ${now} else ${accounts.updatedAt} end`,
        };
    const [row] = await this.db
      .update(accounts)
      .set(changes)
      .where(scopedRow(scope, id))
      .returning(columns);
    return row ?? null;
  }

  async setIncludeInAvailable(
    scope: AccessScope<'write'>,
    id: string,
    value: boolean,
  ): Promise<SetIncludeInAvailableResult> {
    // The locked read classifies and decides the write, so a concurrent archive is either seen
    // here or waits for this transaction; an archived account is never updated.
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select(columns)
        .from(accounts)
        .where(scopedRow(scope, id))
        .limit(1)
        .for('update');
      if (!row) return { status: 'not_found' };
      if (row.type === 'credit_card') return { status: 'credit_card' };
      if (row.archivedAt !== null) return { status: 'archived' };
      if (row.includeInAvailable === value) return { status: 'updated', account: row };
      const [updated] = await tx
        .update(accounts)
        .set({ includeInAvailable: value, updatedAt: sql`now()` })
        .where(scopedRow(scope, id))
        .returning(columns);
      if (!updated) throw new Error('Updating a locked account returned no row');
      return { status: 'updated', account: updated };
    });
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    try {
      const rows = await this.db
        .delete(accounts)
        .where(scopedRow(scope, id))
        .returning({ id: accounts.id });
      return rows.length === 1;
    } catch (error) {
      const constraint = violatedConstraint(error, '23503');
      if (constraint === undefined) throw error;
      // The card keys restrict deletion of a linked account (DISC-001-10a D2); any other key is a movement.
      throw constraint.startsWith('credit_cards_')
        ? new AccountLinkedToCard()
        : new AccountHasMovements();
    }
  }
}
