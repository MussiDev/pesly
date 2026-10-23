import {
  budgetSpendingResponseSchema,
  sendMovementToGroupResponseSchema,
  type BudgetSpendingResponse,
} from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBudgetRoutes } from '../../src/budgets';
import { createGroupRoutes } from '../../src/groups';
import { renderGroupNoticeText } from '../../src/notices';
import { createMovementRoutes } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { newGroupCategory } from '../budgets/spending-fixtures';
import { createIdentityHarness } from '../helpers/identity-harness';
import { seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from '../movements/db-fixtures';
import {
  call,
  createGroup,
  invitationTokenOf,
  PASSWORD,
  readGroup,
  type TestUser,
} from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 12900000, 13000000, now(), now())`,
  );
});

/** Groups, movements and budgets mounted on one real session stack. */
function buildApi() {
  const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
  const clock = new MutableClock(new Date('2026-10-10T12:00:00.000Z'));
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createGroupRoutes({
        db: connection.db,
        logger,
        clock,
        renderNoticeText: renderGroupNoticeText,
      }),
      createMovementRoutes({ db: connection.db, logger, clock }),
      createBudgetRoutes({ db: connection.db, logger, clock }),
    ],
  });
  let sequence = 0;
  async function makeUser(name: string): Promise<TestUser> {
    sequence += 1;
    const email = `${name}-${sequence}-${Date.now()}@http-flow.test`;
    const id = await seedUser(connection, { email, password: PASSWORD });
    return { id, email, cookies: sessionFrom(await signIn(harness.app, email, PASSWORD)) };
  }
  return { app: harness.app, makeUser };
}

describe('send a movement to a group, over HTTP, against the budget spending read', () => {
  it('counts the amount fully, then only the sender share once, then fully again after the delete (AC-16, FR-06, AC-29, AC-30)', async () => {
    const api = buildApi();
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const joined = await call(api.app, 'post', '/groups/join', bob.cookies, {
      token: await invitationTokenOf(api.app, ana, group.id),
    });
    expect(joined.status).toBe(200);
    const memberIds = (await readGroup(api.app, ana, group.id)).members.map((m) => m.id);
    expect(memberIds).toHaveLength(2);

    const pool = connection.pool;
    const accountId = await newAccount(pool, ana.id, false, 'ARS');
    const categoryId = await newCategory(pool, ana.id, 'expense');
    const categoryRow = await pool.query<{ name: string }>(
      'select name from categories where id = $1',
      [categoryId],
    );
    const categoryName = categoryRow.rows[0]?.name;
    expect(categoryName).toBeTruthy();
    // The share counts toward a budget by the matching category name (PRD 04 AC-10).
    const groupCategoryId = await newGroupCategory(pool, group.id, { name: categoryName ?? null });

    const budgetResponse = await call(api.app, 'post', '/budgets', ana.cookies, {
      name: 'Dinners',
      amount: '20000000',
      currency: 'ARS',
      categoryIds: [categoryId],
    });
    expect(budgetResponse.status).toBe(201);
    const budgetId = (budgetResponse.body as { id: string }).id;

    // 100,000.01 ARS: split in two, the 1-cent leftover goes to the payer (the sender).
    const inserted = await pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source, note)
       values ($1, 'expense', $2, $3, 10000001, '2026-10-09T10:00:00.000Z', 14000000, 'manual', 'Cena') returning id`,
      [ana.id, accountId, categoryId],
    );
    const movementId = inserted.rows[0]?.id ?? '';

    const spending = async (): Promise<BudgetSpendingResponse> => {
      const response = await call(api.app, 'get', `/budgets/${budgetId}/spending`, ana.cookies);
      expect(response.status).toBe(200);
      return budgetSpendingResponseSchema.parse(response.body);
    };
    const movementRow = async () =>
      (
        await pool.query<{ amount: string; category_id: string }>(
          'select amount::text, category_id from movements where id = $1',
          [movementId],
        )
      ).rows;

    const before = await spending();
    expect(before).toMatchObject({ spent: '10000001', remaining: '9999999' });

    const sent = await call(
      api.app,
      'post',
      `/groups/${group.id}/expenses/from-movement`,
      ana.cookies,
      {
        movementId,
        categoryId: groupCategoryId,
        split: { mode: 'equal', memberIds },
      },
    );
    expect(sent.status).toBe(201);
    const expense = sendMovementToGroupResponseSchema.parse(sent.body);
    expect(expense.payerMovementId).toBe(movementId);
    expect(expense.amount).toBe('10000001');
    const mine = expense.shares.find((s) => s.memberId === expense.payerMemberId);
    expect(mine?.amount).toBe('5000001');
    expect(expense.shares.reduce((sum, s) => sum + BigInt(s.amount), 0n)).toBe(10000001n);

    // Only the sender's share, once: not the movement, not the movement plus the share.
    const during = await spending();
    expect(during).toMatchObject({ spent: '5000001', remaining: '14999999' });
    expect(during.unconvertedShareCount).toBe(0);
    expect(await movementRow()).toEqual([{ amount: '10000001', category_id: categoryId }]);

    const removed = await call(
      api.app,
      'delete',
      `/groups/${group.id}/expenses/${expense.id}?baseVersion=${expense.version}`,
      ana.cookies,
    );
    expect(removed.status).toBe(204);

    // The movement is detached, kept, and counts fully again.
    expect(await movementRow()).toEqual([{ amount: '10000001', category_id: categoryId }]);
    const links = await pool.query('select 1 from group_expenses where payer_movement_id = $1', [
      movementId,
    ]);
    expect(links.rowCount).toBe(0);
    const after = await spending();
    expect(after).toMatchObject({ spent: '10000001', remaining: '9999999' });
    expect(after).toEqual(before);
  });
  it('keeps counting the sender share in the Food budget on the automatic category path (05i D18)', async () => {
    const api = buildApi();
    const ana = await api.makeUser('ana');
    const bob = await api.makeUser('bob');
    const group = await createGroup(api.app, ana);
    const joined = await call(api.app, 'post', '/groups/join', bob.cookies, {
      token: await invitationTokenOf(api.app, ana, group.id),
    });
    expect(joined.status).toBe(200);
    const memberIds = (await readGroup(api.app, ana, group.id)).members.map((m) => m.id);

    const pool = connection.pool;
    const accountId = await newAccount(pool, ana.id, false, 'ARS');
    const food = await pool.query<{ id: string }>(
      `insert into categories (owner_id, kind, default_key, name, icon, color)
       values ($1, 'expense', 'food', null, 'wallet', 'blue') returning id`,
      [ana.id],
    );
    const foodId = food.rows[0]?.id ?? '';
    const existing = await pool.query(
      "select 1 from group_categories where group_id = $1 and default_key = 'food'",
      [group.id],
    );
    if (existing.rowCount === 0) {
      await newGroupCategory(pool, group.id, { name: null, defaultKey: 'food' });
    }

    const budget = await call(api.app, 'post', '/budgets', ana.cookies, {
      name: 'Food',
      amount: '20000000',
      currency: 'ARS',
      categoryIds: [foodId],
    });
    expect(budget.status).toBe(201);
    const budgetId = (budget.body as { id: string }).id;
    const inserted = await pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source, note)
       values ($1, 'expense', $2, $3, 10000000, '2026-10-09T10:00:00.000Z', 14000000, 'manual', 'Super') returning id`,
      [ana.id, accountId, foodId],
    );
    const movementId = inserted.rows[0]?.id ?? '';

    const sent = await call(
      api.app,
      'post',
      `/groups/${group.id}/expenses/from-movement`,
      ana.cookies,
      { movementId, split: { mode: 'equal', memberIds } },
    );
    expect(sent.status).toBe(201);
    expect(sendMovementToGroupResponseSchema.parse(sent.body).autoCategory).toBeNull();

    const response = await call(api.app, 'get', `/budgets/${budgetId}/spending`, ana.cookies);
    expect(response.status).toBe(200);
    // Under 'other-expenses' the share would not match the Food budget and spent would be 0.
    expect(budgetSpendingResponseSchema.parse(response.body)).toMatchObject({
      spent: '5000000',
      remaining: '15000000',
    });
  });
});
