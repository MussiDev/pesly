import { accountResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { createAccountMovements } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from '../movements/db-fixtures';
import {
  get,
  movementBody,
  obligationsSetup,
  send,
  type ObligationsSetup,
} from '../movements/obligations-harness';
import { newDbWorld, plainSettlement, type DbWorld } from './settlement-db-world';

/** The account balance reads the settlement rows (spec D5): no movement is created. */

let connection: DatabaseConnection;
let repository: DrizzleGroupSettlementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGroupSettlementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

interface Setup {
  s: ObligationsSetup;
  w: DbWorld;
  /** Ana's registered member and a ghost. */
  ana: string;
  ghost: string;
}

async function setup(): Promise<Setup> {
  const s = await obligationsSetup(connection);
  const w = await newDbWorldFor(s.anaId);
  return { s, w, ana: w.anaMember, ghost: w.memberIds[1] ?? '' };
}

async function newDbWorldFor(userId: string): Promise<DbWorld> {
  // The helper creates its own user; this group is created for the session user instead.
  const w = await newDbWorld(connection.db, connection.pool, { ghosts: 1 });
  await connection.pool.query('update group_members set user_id = $1 where id = $2', [
    userId,
    w.anaMember,
  ]);
  return { ...w, userId };
}

async function createAccount(
  s: ObligationsSetup,
  openingBalance: string,
  name = 'Caja',
): Promise<string> {
  const response = await send(s.app, 'post', '/accounts', s.ana, {
    name,
    type: 'cash',
    currency: 'ARS',
    openingBalance,
  });
  expect(response.status).toBe(201);
  return accountResponseSchema.parse(response.body).id;
}

async function balanceOf(s: ObligationsSetup, id: string): Promise<string | undefined> {
  const response = await get(s.app, '/accounts?archived=false&limit=100', s.ana);
  expect(response.status).toBe(200);
  const items = (response.body as { items: { id: string; balance: string }[] }).items;
  return items.find((item) => item.id === id)?.balance;
}

async function movementTotals(
  userId: string,
): Promise<{ rows: number; income: string; expense: string }> {
  const result = await connection.pool.query<{ rows: string; income: string; expense: string }>(
    `select count(*) as rows,
       coalesce(sum(amount) filter (where type = 'income'), 0)::text as income,
       coalesce(sum(amount) filter (where type = 'expense'), 0)::text as expense
     from movements where owner_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  return { rows: Number(row?.rows), income: row?.income ?? '', expense: row?.expense ?? '' };
}

describe('account balance with settlements', () => {
  it('rises by a received settlement and drops by a paid one, with no movement row and the same totals', async () => {
    const { s, w, ana, ghost } = await setup();
    const accountId = await createAccount(s, '10000');
    const categoryId = await newCategory(connection.pool, s.anaId, 'income');
    const income = await send(
      s.app,
      'post',
      '/movements',
      s.ana,
      movementBody({ type: 'income', accountId, categoryId, amount: '5000' }),
    );
    expect(income.status).toBe(201);
    const before = await movementTotals(s.anaId);
    expect(await balanceOf(s, accountId)).toBe('15000');

    await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ghost,
        toMemberId: ana,
        amount: 2_500n,
        legs: [{ currency: 'ARS', amount: 2_500n }],
        account: { accountId, memberId: ana },
      }),
    );
    expect(await balanceOf(s, accountId)).toBe('17500');

    await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ana,
        toMemberId: ghost,
        amount: 400n,
        legs: [{ currency: 'ARS', amount: 400n }],
        account: { accountId, memberId: ana },
      }),
    );
    expect(await balanceOf(s, accountId)).toBe('17100');
    expect(await movementTotals(s.anaId)).toEqual(before);
    expect(await createAccountMovements(connection.db).sumsByAccount([accountId])).toEqual(
      new Map([[accountId, 7_100n]]),
    );
  });

  it('ignores a settlement whose account was erased (null account_id) and one without an account', async () => {
    const { s, w, ana, ghost } = await setup();
    const accountId = await createAccount(s, '0');
    await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ghost,
        toMemberId: ana,
        amount: 700n,
        legs: [{ currency: 'ARS', amount: 700n }],
      }),
    );
    await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ghost,
        toMemberId: ana,
        amount: 300n,
        legs: [{ currency: 'ARS', amount: 300n }],
        account: { accountId, memberId: ana },
      }),
    );
    expect(await balanceOf(s, accountId)).toBe('300');

    await connection.pool.query('update group_settlements set account_id = null');

    expect(await balanceOf(s, accountId)).toBe('0');
    expect(await createAccountMovements(connection.db).hasMovements(accountId)).toBe(false);
  });

  it('does not delete an account that has settlements and answers a 409 conflict', async () => {
    const { s, w, ana, ghost } = await setup();
    const accountId = await createAccount(s, '0');
    const untouched = await createAccount(s, '0', 'Otra');
    await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ghost,
        toMemberId: ana,
        amount: 100n,
        legs: [{ currency: 'ARS', amount: 100n }],
        account: { accountId, memberId: ana },
      }),
    );

    const refused = await send(s.app, 'delete', `/accounts/${accountId}`, s.ana);
    const allowed = await send(s.app, 'delete', `/accounts/${untouched}`, s.ana);

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ code: 'ACCOUNT_HAS_MOVEMENTS' });
    expect(allowed.status).toBe(204);
    expect(await createAccountMovements(connection.db).hasMovements(accountId)).toBe(true);
    expect(await createAccountMovements(connection.db).hasMovements(untouched)).toBe(false);
  });

  it('keeps the account of another user out of the sums (isolation)', async () => {
    const { s, w, ana, ghost } = await setup();
    const mine = await createAccount(s, '0');
    const stranger = await newAccount(connection.pool, s.bobId);
    await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ghost,
        toMemberId: ana,
        amount: 100n,
        legs: [{ currency: 'ARS', amount: 100n }],
        account: { accountId: mine, memberId: ana },
      }),
    );

    const sums = await createAccountMovements(connection.db).sumsByAccount([mine, stranger]);

    expect(sums.get(mine)).toBe(100n);
    expect(sums.has(stranger)).toBe(false);
  });
});
