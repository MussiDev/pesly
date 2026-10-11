import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrizzleBudgetVersionReader } from '../../src/budgets/infrastructure/db/drizzle-budget-version-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, readScope } from '../movements/db-fixtures';
import {
  newBudgetWithVersions,
  newChildCategory,
  newNamedCategory,
  statementsOf,
} from './spending-fixtures';

let connection: DatabaseConnection;
let reader: DrizzleBudgetVersionReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleBudgetVersionReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const SEPTEMBER = '2026-09';
const OCTOBER = '2026-10';

async function owner() {
  const ownerId = await newUserId(connection.db);
  return { ownerId, scope: await readScope(ownerId) };
}

describe('DrizzleBudgetVersionReader.forMonths', () => {
  it('returns the September version for September and the October version for October; a month before the first is null (AC-06, AC-17)', async () => {
    const { ownerId, scope } = await owner();
    const food = await newCategory(connection.pool, ownerId, 'expense');
    const budgetId = await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [
        { effectiveFrom: '2026-09-01', amount: 10000000n, categoryIds: [food] },
        { effectiveFrom: '2026-10-01', amount: 15000000n, categoryIds: [food] },
      ],
    });

    const [budget] = await reader.forMonths(scope, ['2026-08', SEPTEMBER, OCTOBER]);

    expect(budget?.budgetId).toBe(budgetId);
    expect(budget?.currency).toBe('ARS');
    expect(budget?.byMonth.get('2026-08')).toBeNull();
    expect(budget?.byMonth.get(SEPTEMBER)?.version.amount).toBe(10000000n);
    expect(budget?.byMonth.get(SEPTEMBER)?.version.effectiveFrom).toBe('2026-09-01');
    expect(budget?.byMonth.get(OCTOBER)?.version.amount).toBe(15000000n);
  });

  it('keeps using the latest version at or before the month when no version starts in it', async () => {
    const { ownerId, scope } = await owner();
    const food = await newCategory(connection.pool, ownerId, 'expense');
    await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [{ effectiveFrom: '2026-07-01', amount: 7n, rollover: true, categoryIds: [food] }],
    });

    const [budget] = await reader.forMonths(scope, [OCTOBER]);

    expect(budget?.byMonth.get(OCTOBER)?.version).toMatchObject({
      effectiveFrom: '2026-07-01',
      amount: 7n,
      rollover: true,
    });
  });

  it('returns the version fields: name, selected ids and ascending thresholds', async () => {
    const { ownerId, scope } = await owner();
    const food = await newCategory(connection.pool, ownerId, 'expense');
    await newBudgetWithVersions(connection.pool, {
      ownerId,
      currency: 'USD',
      versions: [
        {
          effectiveFrom: '2026-10-01',
          name: 'Groceries',
          amount: 500n,
          categoryIds: [food],
          thresholds: [100, 50, 80],
        },
      ],
    });

    const [budget] = await reader.forMonths(scope, [OCTOBER]);

    expect(budget?.currency).toBe('USD');
    expect(budget?.byMonth.get(OCTOBER)?.version).toEqual({
      effectiveFrom: '2026-10-01',
      name: 'Groceries',
      amount: 500n,
      rollover: false,
      categoryIds: [food],
      thresholds: [50, 80, 100],
    });
  });

  it('covers the selected categories and the children of a selected parent, also one created later (AC-02)', async () => {
    const { ownerId, scope } = await owner();
    const parent = await newNamedCategory(connection.pool, ownerId, { name: 'Food' });
    const child = await newChildCategory(connection.pool, ownerId, parent, 'Bakery');
    await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [parent] }],
    });
    const lateChild = await newChildCategory(connection.pool, ownerId, parent, 'Late');

    const [budget] = await reader.forMonths(scope, [SEPTEMBER]);
    const covered = budget?.byMonth.get(SEPTEMBER)?.covered ?? [];

    expect(covered.map((category) => category.id).sort()).toEqual(
      [parent, child, lateChild].sort(),
    );
    expect(covered.find((category) => category.id === child)).toEqual({
      id: child,
      name: 'Bakery',
      defaultKey: null,
    });
    expect(budget?.byMonth.get(SEPTEMBER)?.version.categoryIds).toEqual([parent]);
  });

  it('returns the default key of a covered category with no custom name', async () => {
    const { ownerId, scope } = await owner();
    const food = await newNamedCategory(connection.pool, ownerId, {
      name: null,
      defaultKey: 'food',
    });
    await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [food] }],
    });

    const [budget] = await reader.forMonths(scope, [SEPTEMBER]);

    expect(budget?.byMonth.get(SEPTEMBER)?.covered).toEqual([
      { id: food, name: null, defaultKey: 'food' },
    ]);
  });

  it('uses the categories of each month own version (AC-06)', async () => {
    const { ownerId, scope } = await owner();
    const food = await newCategory(connection.pool, ownerId, 'expense');
    const fun = await newCategory(connection.pool, ownerId, 'expense');
    await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [
        { effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [food] },
        { effectiveFrom: '2026-10-01', amount: 100n, categoryIds: [fun] },
      ],
    });

    const [budget] = await reader.forMonths(scope, [SEPTEMBER, OCTOBER]);

    expect(budget?.byMonth.get(SEPTEMBER)?.covered.map((category) => category.id)).toEqual([food]);
    expect(budget?.byMonth.get(OCTOBER)?.covered.map((category) => category.id)).toEqual([fun]);
  });

  it('lists a budget that did not exist yet with null for every month, in creation order', async () => {
    const { ownerId, scope } = await owner();
    const food = await newCategory(connection.pool, ownerId, 'expense');
    const first = await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [{ effectiveFrom: '2026-12-01', amount: 100n, categoryIds: [food] }],
    });
    const second = await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [food] }],
    });

    const budgets = await reader.forMonths(scope, [OCTOBER]);

    expect(budgets.map((budget) => budget.budgetId)).toEqual([first, second]);
    expect(budgets[0]?.byMonth.get(OCTOBER)).toBeNull();
    expect(budgets[1]?.byMonth.get(OCTOBER)).not.toBeNull();
  });

  it('reads one budget by id and returns nothing for an unknown or foreign id (AC-23)', async () => {
    const ana = await owner();
    const bea = await owner();
    const anaFood = await newCategory(connection.pool, ana.ownerId, 'expense');
    const beaFood = await newCategory(connection.pool, bea.ownerId, 'expense');
    const own = await newBudgetWithVersions(connection.pool, {
      ownerId: ana.ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [anaFood] }],
    });
    await newBudgetWithVersions(connection.pool, {
      ownerId: ana.ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [anaFood] }],
    });
    const foreign = await newBudgetWithVersions(connection.pool, {
      ownerId: bea.ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [beaFood] }],
    });

    const one = await reader.forMonths(ana.scope, [OCTOBER], own);
    const foreignRead = await reader.forMonths(ana.scope, [OCTOBER], foreign);
    const unknown = await reader.forMonths(
      ana.scope,
      [OCTOBER],
      '00000000-0000-4000-8000-000000000000',
    );

    expect(one.map((budget) => budget.budgetId)).toEqual([own]);
    expect(foreignRead).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it('never returns the budgets, versions or categories of another user (AC-24)', async () => {
    const ana = await owner();
    const bea = await owner();
    const beaParent = await newCategory(connection.pool, bea.ownerId, 'expense');
    await newChildCategory(connection.pool, bea.ownerId, beaParent);
    await newBudgetWithVersions(connection.pool, {
      ownerId: bea.ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [beaParent] }],
    });

    expect(await reader.forMonths(ana.scope, [SEPTEMBER, OCTOBER])).toEqual([]);
    const [mine] = await reader.forMonths(bea.scope, [SEPTEMBER]);
    expect(mine?.byMonth.get(SEPTEMBER)?.covered).toHaveLength(2);
  });

  it('issues the same fixed number of statements for 1 and for 50 budgets (NFR-01)', async () => {
    const { ownerId, scope } = await owner();
    const parent = await newCategory(connection.pool, ownerId, 'expense');
    await newChildCategory(connection.pool, ownerId, parent);
    await newBudgetWithVersions(connection.pool, {
      ownerId,
      versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [parent] }],
    });
    const spy = vi.spyOn(connection.pool, 'query');
    await reader.forMonths(scope, [SEPTEMBER, OCTOBER]);
    const forOne = statementsOf(spy.mock.calls).length;
    spy.mockClear();

    for (let index = 0; index < 49; index += 1) {
      const category = await newCategory(connection.pool, ownerId, 'expense');
      await newBudgetWithVersions(connection.pool, {
        ownerId,
        versions: [{ effectiveFrom: '2026-09-01', amount: 100n, categoryIds: [category, parent] }],
      });
    }
    spy.mockClear();
    const budgets = await reader.forMonths(scope, [SEPTEMBER, OCTOBER]);
    const forFifty = statementsOf(spy.mock.calls).length;
    spy.mockRestore();

    expect(budgets).toHaveLength(50);
    expect(forOne).toBeGreaterThan(0);
    expect(forFifty).toBe(forOne);
    expect(forFifty).toBeLessThanOrEqual(8);
  });

  it('answers an empty list for a caller with no budgets and for no months without failing', async () => {
    const { scope } = await owner();

    expect(await reader.forMonths(scope, [OCTOBER])).toEqual([]);
    expect(await reader.forMonths(scope, [])).toEqual([]);
  });

  it('rethrows a database failure instead of swallowing it', async () => {
    const { scope } = await owner();
    const dead = createDatabase(testDatabaseUrl);
    await dead.pool.end();

    await expect(
      new DrizzleBudgetVersionReader(dead.db).forMonths(scope, [OCTOBER]),
    ).rejects.toThrow();
  });
});
