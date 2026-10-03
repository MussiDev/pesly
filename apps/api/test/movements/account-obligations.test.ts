import { accountResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newTransfer } from './db-fixtures';
import {
  get,
  movementBody,
  obligationsSetup,
  send,
  type ObligationsSetup,
} from './obligations-harness';

/** Deferred behavior of DISC-001-02a, end to end with real movements (spec 03b, Block 7). */

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

interface ListedAccount {
  id: string;
  balance: string;
}

async function createAccount(
  s: ObligationsSetup,
  openingBalance: string,
  owner: 'ana' | 'bob' = 'ana',
  name = 'Caja',
): Promise<string> {
  const response = await send(s.app, 'post', '/accounts', owner === 'ana' ? s.ana : s.bob, {
    name,
    type: 'cash',
    currency: 'ARS',
    openingBalance,
  });
  expect(response.status).toBe(201);
  return accountResponseSchema.parse(response.body).id;
}

async function countRows(table: 'accounts' | 'movements', ownerId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where owner_id = $1`,
    [ownerId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function balances(s: ObligationsSetup, archived = false): Promise<Map<string, string>> {
  const response = await get(s.app, `/accounts?archived=${String(archived)}&limit=100`, s.ana);
  expect(response.status).toBe(200);
  const body = response.body as { items: ListedAccount[] };
  return new Map(body.items.map((item) => [item.id, item.balance]));
}

describe('account obligations with real movements', () => {
  // The 409 comes from the foreign key as well as the real adapter; the wiring is pinned by the server.ts source check in erasure-step.test.ts.
  it('an account with a real movement cannot be deleted and both rows remain (AC-18)', async () => {
    const s = await obligationsSetup(connection);
    const accountId = await createAccount(s, '0');
    const categoryId = await newCategory(connection.pool, s.anaId, 'expense');
    const created = await send(
      s.app,
      'post',
      '/movements',
      s.ana,
      movementBody({ type: 'expense', accountId, categoryId, amount: '5000' }),
    );
    expect(created.status).toBe(201);

    const response = await send(s.app, 'delete', `/accounts/${accountId}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_HAS_MOVEMENTS' });
    expect(await countRows('accounts', s.anaId)).toBe(1);
    expect(await countRows('movements', s.anaId)).toBe(1);
  });

  // hasMovements already covers destination_account_id, so this documents behavior owned by the adapter.
  it('an account that is only the destination of a transfer cannot be deleted and is kept', async () => {
    const s = await obligationsSetup(connection);
    const source = await createAccount(s, '1000');
    const destination = await createAccount(s, '0', 'ana', 'Destino');
    await newTransfer(connection.pool, {
      ownerId: s.anaId,
      accountId: source,
      destinationAccountId: destination,
      amount: 200n,
    });

    const response = await send(s.app, 'delete', `/accounts/${destination}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_HAS_MOVEMENTS' });
    expect(await countRows('accounts', s.anaId)).toBe(2);
    expect((await balances(s)).get(destination)).toBe('200');
  });

  it('archiving keeps the movements in the list and unarchiving restores the account (FR-12)', async () => {
    const s = await obligationsSetup(connection);
    const accountId = await createAccount(s, '1000');
    const categoryId = await newCategory(connection.pool, s.anaId, 'expense');
    await send(
      s.app,
      'post',
      '/movements',
      s.ana,
      movementBody({ type: 'expense', accountId, categoryId, amount: '300' }),
    );

    expect((await send(s.app, 'post', `/accounts/${accountId}/archive`, s.ana)).status).toBe(200);
    const listed = await get(s.app, '/movements', s.ana);
    expect(listed.status).toBe(200);
    expect(
      (listed.body as { items: { accountId: string }[] }).items.map((m) => m.accountId),
    ).toEqual([accountId]);
    expect((await balances(s)).has(accountId)).toBe(false);
    expect((await balances(s, true)).get(accountId)).toBe('700');

    expect((await send(s.app, 'post', `/accounts/${accountId}/unarchive`, s.ana)).status).toBe(200);
    expect((await balances(s)).get(accountId)).toBe('700');
    const again = await get(s.app, '/movements', s.ana);
    expect((again.body as { total: number }).total).toBe(1);
  });

  it('the balance is opening plus incomes minus expenses and ignores other users (AC-12, AC-13)', async () => {
    const s = await obligationsSetup(connection);
    const accountId = await createAccount(s, '2500');
    const expense = await newCategory(connection.pool, s.anaId, 'expense');
    const income = await newCategory(connection.pool, s.anaId, 'income');
    const bobAccount = await createAccount(s, '0', 'bob');
    const bobExpense = await newCategory(connection.pool, s.bobId, 'expense');

    for (const [type, categoryId, amount] of [
      ['income', income, '10000'],
      ['expense', expense, '400'],
      ['expense', expense, '150'],
    ] as const) {
      const response = await send(
        s.app,
        'post',
        '/movements',
        s.ana,
        movementBody({ type, accountId, categoryId, amount }),
      );
      expect(response.status).toBe(201);
    }
    const bobMovement = await send(
      s.app,
      'post',
      '/movements',
      s.bob,
      movementBody({
        type: 'expense',
        accountId: bobAccount,
        categoryId: bobExpense,
        amount: '999999',
      }),
    );
    expect(bobMovement.status).toBe(201);

    expect((await balances(s)).get(accountId)).toBe((2500n + 10000n - 400n - 150n).toString());
    const single = await get(s.app, `/accounts/${accountId}`, s.ana);
    expect(accountResponseSchema.parse(single.body).balance).toBe('11950');
  });

  it("deleting another user's account that has movements answers 404 and changes nothing (AC-16)", async () => {
    const s = await obligationsSetup(connection);
    const bobAccount = await createAccount(s, '0', 'bob');
    const bobCategory = await newCategory(connection.pool, s.bobId, 'expense');
    await send(
      s.app,
      'post',
      '/movements',
      s.bob,
      movementBody({
        type: 'expense',
        accountId: bobAccount,
        categoryId: bobCategory,
        amount: '100',
      }),
    );

    const response = await send(s.app, 'delete', `/accounts/${bobAccount}`, s.ana);
    expect(response.status).toBe(404);
    expect(await countRows('accounts', s.bobId)).toBe(1);
    expect(await countRows('movements', s.bobId)).toBe(1);
  });
});
