import { randomUUID } from 'node:crypto';
import type { CategoryKind } from '@pesly/shared';
import type pg from 'pg';
import { Email } from '../../src/identity/domain/email';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../src/shared/db/client';

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

export function writeScope(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'write');
}

export function readScope(userId: string): Promise<AccessScope<'read'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'read');
}

function firstId(rows: { id: string }[]): string {
  const row = rows[0];
  if (!row) throw new Error('The insert returned no row');
  return row.id;
}

export async function newUserId(
  db: Database,
  options: { timeZone?: string; rateType?: 'mep' | 'blue' | 'oficial' } = {},
): Promise<string> {
  const user = await new DrizzleUserRepository(db).create({
    email: Email.parse(`u-${randomUUID()}@example.com`),
    passwordHash: 'h',
    defaultRateType: options.rateType ?? 'mep',
    displayCurrency: 'ARS',
    timeZone: options.timeZone ?? 'America/Cordoba',
    language: 'es',
  });
  return user.id;
}

export async function newAccount(
  pool: pg.Pool,
  ownerId: string,
  archived = false,
  currency: 'ARS' | 'USD' = 'ARS',
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available, archived_at)
     values ($1, $2, 'cash', $4, 0, true, $3) returning id`,
    [ownerId, `Caja ${randomUUID()}`, archived ? new Date() : null, currency],
  );
  return firstId(result.rows);
}

export async function newCategory(
  pool: pg.Pool,
  ownerId: string,
  kind: CategoryKind,
  archived = false,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, name, icon, color, archived_at)
     values ($1, $2, $3, 'wallet', 'blue', $4) returning id`,
    [ownerId, kind, `Cat ${randomUUID()}`, archived ? new Date() : null],
  );
  return firstId(result.rows);
}

export async function newMovement(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    accountId: string;
    categoryId: string;
    type: CategoryKind;
    amount: bigint;
  },
): Promise<void> {
  await pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, $2, $3, $4, $5, now(), 14000000, 'manual')`,
    [
      fixture.ownerId,
      fixture.type,
      fixture.accountId,
      fixture.categoryId,
      fixture.amount.toString(),
    ],
  );
}

/** A raw transfer row: no category, no rate, the destination amount equals the amount. */
export async function newTransfer(
  pool: pg.Pool,
  fixture: { ownerId: string; accountId: string; destinationAccountId: string; amount: bigint },
): Promise<void> {
  await pool.query(
    `insert into movements (owner_id, type, account_id, destination_account_id, amount, destination_amount, occurred_at)
     values ($1, 'transfer', $2, $3, $4, $4, now())`,
    [fixture.ownerId, fixture.accountId, fixture.destinationAccountId, fixture.amount.toString()],
  );
}

/** A raw exchange row with its implied rate and no category. */
export async function newExchange(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    accountId: string;
    destinationAccountId: string;
    amount: bigint;
    destinationAmount: bigint;
    rate: bigint;
  },
): Promise<void> {
  await pool.query(
    `insert into movements (owner_id, type, account_id, destination_account_id, amount, destination_amount, occurred_at, rate, rate_source)
     values ($1, 'exchange', $2, $3, $4, $5, now(), $6, 'implied')`,
    [
      fixture.ownerId,
      fixture.accountId,
      fixture.destinationAccountId,
      fixture.amount.toString(),
      fixture.destinationAmount.toString(),
      fixture.rate.toString(),
    ],
  );
}

/** A tag row of the owner, bypassing the repositories. */
export async function newTag(pool: pg.Pool, ownerId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'insert into tags (owner_id, name) values ($1, $2) returning id',
    [ownerId, name],
  );
  return firstId(result.rows);
}

/** Links a movement to a tag of the same owner at `position`, bypassing the repositories. */
export async function linkTag(
  pool: pg.Pool,
  link: { movementId: string; tagId: string; ownerId: string; position: number },
): Promise<void> {
  await pool.query(
    'insert into movement_tags (movement_id, tag_id, owner_id, position) values ($1, $2, $3, $4)',
    [link.movementId, link.tagId, link.ownerId, link.position],
  );
}
