import { categoryDetailResponseSchema, dashboardResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
} from '../budgets/spending-fixtures';
import { FixedClock } from '../dashboard/fakes';
import { addRealUser, buildRealApp, getJson } from '../dashboard/real-app';
import { seedGroup, seedRate, seedWorld } from '../dashboard/world-fixtures';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const AFTER_DUE = new Date('2026-10-10T16:00:00.000Z');

async function idOf(sql: string, params: unknown[]): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(sql, params);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('No row');
  return id;
}

/**
 * The dashboard world, plus what the movement list of the month cannot show for the category: a
 * September card purchase due in October, the user's share of a group expense somebody else paid,
 * and a subcategory movement.
 */
async function world() {
  const { app } = buildRealApp(connection, new FixedClock(AFTER_DUE));
  await seedRate(connection.pool);
  const ana = await addRealUser(connection, app, 'ana');
  const bea = await addRealUser(connection, app, 'bea');
  const seeded = await seedWorld(connection, ana.id, 'ana');
  await seedGroup(connection.pool, ana.id, bea.id);

  const cardArs = await idOf('select id from accounts where owner_id = $1 and name = $2', [
    ana.id,
    'ana card ARS',
  ]);
  const cardPurchase = await newMovementAt(connection.pool, {
    ownerId: ana.id,
    accountId: cardArs,
    categoryId: seeded.food,
    amount: 300000n,
    occurredAt: '2026-09-15T15:00:00Z',
  });
  const groceries = await idOf(
    `insert into categories (owner_id, kind, name, icon, color, parent_id)
     values ($1, 'expense', 'Groceries', 'wallet', 'blue', $2) returning id`,
    [ana.id, seeded.food],
  );
  await newMovementAt(connection.pool, {
    ownerId: ana.id,
    accountId: seeded.accountArs,
    categoryId: groceries,
    amount: 150000n,
    occurredAt: '2026-10-05T15:00:00Z',
  });

  const foodName = await idOf('select name as id from categories where id = $1', [seeded.food]);
  const groupId = await newGroup(connection.pool);
  const anaMember = await newMember(connection.pool, groupId, ana.id);
  const beaMember = await newMember(connection.pool, groupId, bea.id);
  const groupFood = await newGroupCategory(connection.pool, groupId, { name: foodName });
  await newGroupExpense(connection.pool, {
    groupId,
    payerMemberId: beaMember,
    categoryId: groupFood,
    amount: 1000000n,
    occurredAt: '2026-10-04T15:00:00Z',
    shares: [
      { memberId: anaMember, amount: 700000n },
      { memberId: beaMember, amount: 300000n },
    ],
  });

  return { app, ana, bea, seeded, cardPurchase, groceries, groupId };
}

describe('GET /reports/category-detail', () => {
  it('adds up to the dashboard category figure and lists every part of it', async () => {
    const { app, ana, seeded, cardPurchase, groceries, groupId } = await world();

    const dashboard = dashboardResponseSchema.parse(
      (await getJson(app, '/dashboard', ana.cookies)).body,
    );
    const food = dashboard.categories.find((row) => row.categoryId === seeded.food);
    expect(food).toBeDefined();

    const response = await getJson(
      app,
      `/reports/category-detail?categoryId=${seeded.food}&month=2026-10`,
      ana.cookies,
    );
    expect(response.status).toBe(200);
    const detail = categoryDetailResponseSchema.parse(response.body);

    expect(detail.total).toBe(food?.amount);
    expect(detail.currency).toBe('ARS');
    const sources = detail.items.map((item) => item.source).sort();
    expect(sources).toEqual([
      'cardPurchase',
      'installment',
      'movement',
      'movement',
      'movement',
      'share',
    ]);
    expect(detail.items.find((item) => item.source === 'cardPurchase')).toMatchObject({
      movementId: cardPurchase,
      day: '2026-09-15',
      dueDate: '2026-10-09',
      amount: '300000',
    });
    expect(detail.items.find((item) => item.source === 'installment')).toMatchObject({
      dueDate: '2026-10-09',
      installment: { number: 1, count: 4 },
      amount: '500000',
    });
    expect(detail.items.find((item) => item.source === 'share')).toMatchObject({
      group: { id: groupId },
      originalAmount: '700000',
      amount: '700000',
    });
    expect(detail.items.some((item) => item.category?.id === groceries)).toBe(true);
    const usd = detail.items.find((item) => item.currency === 'USD');
    expect(usd?.originalAmount).toBe('2000');
    expect(usd?.amount).not.toBeNull();
    // Newest first.
    const days = detail.items.map((item) => item.day);
    expect(days).toEqual([...days].sort().reverse());
  });

  it('answers 404 for a category of another user and 400 for a malformed month', async () => {
    const { app, bea, seeded } = await world();

    const foreign = await getJson(
      app,
      `/reports/category-detail?categoryId=${seeded.food}&month=2026-10`,
      bea.cookies,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.text).not.toContain(seeded.food);

    const bad = await getJson(
      app,
      `/reports/category-detail?categoryId=${seeded.food}&month=2026-13`,
      bea.cookies,
    );
    expect(bad.status).toBe(400);
  });
});
