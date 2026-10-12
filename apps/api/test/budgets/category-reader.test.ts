import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCategoryReader } from '../../src/budgets/infrastructure/db/drizzle-category-reader';
import { DrizzleUserTimeZone } from '../../src/budgets/infrastructure/db/drizzle-user-time-zone';
import { SystemClock } from '../../src/budgets/infrastructure/clock/system-clock';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, readScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('DrizzleCategoryReader', () => {
  it('returns kind and archived state of own categories and omits foreign and unknown ids', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const expense = await newCategory(connection.pool, ana, 'expense');
    const income = await newCategory(connection.pool, ana, 'income');
    const archived = await newCategory(connection.pool, ana, 'expense', true);
    const foreign = await newCategory(connection.pool, bea, 'expense');
    const reader = new DrizzleCategoryReader(connection.db);

    const found = await reader.findMany(await readScope(ana), [
      expense,
      income,
      archived,
      foreign,
      '00000000-0000-4000-8000-000000000000',
    ]);

    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect(found.sort(byId)).toEqual(
      [
        { id: expense, kind: 'expense', archived: false },
        { id: income, kind: 'income', archived: false },
        { id: archived, kind: 'expense', archived: true },
      ].sort(byId),
    );
  });

  it('answers an empty list for no ids', async () => {
    const ana = await newUserId(connection.db);
    const reader = new DrizzleCategoryReader(connection.db);

    expect(await reader.findMany(await readScope(ana), [])).toEqual([]);
  });
});

describe('DrizzleUserTimeZone', () => {
  it('reads the zone of the user and fails closed for a missing user', async () => {
    const ana = await newUserId(connection.db, { timeZone: 'America/Cordoba' });
    const zones = new DrizzleUserTimeZone(connection.db);

    expect(await zones.timeZoneOf(ana)).toBe('America/Cordoba');
    await expect(zones.timeZoneOf('00000000-0000-4000-8000-000000000000')).rejects.toThrow();
  });
});

describe('SystemClock', () => {
  it('returns the current instant', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
