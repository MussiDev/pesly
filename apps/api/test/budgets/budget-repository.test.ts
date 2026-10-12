import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleBudgetRepository } from '../../src/budgets/infrastructure/db/drizzle-budget-repository';
import { BudgetLimitReached } from '../../src/budgets/domain/errors';
import type { BudgetVersion } from '../../src/budgets/domain/budget';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, readScope, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let budgets: DrizzleBudgetRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  budgets = new DrizzleBudgetRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const SEPTEMBER = '2026-09-01';
const OCTOBER = '2026-10-01';
const INT64_MAX = 9223372036854775807n;
const BUDGET_TABLES = [
  'budgets',
  'budget_versions',
  'budget_version_categories',
  'budget_version_thresholds',
];

const count = async (statement: string, params: unknown[] = []): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
};

const versionOf = (
  categoryIds: string[],
  overrides: Partial<BudgetVersion> = {},
): BudgetVersion => ({
  effectiveFrom: SEPTEMBER,
  name: 'Food',
  amount: 15000000n,
  rollover: false,
  categoryIds,
  thresholds: [80, 100],
  ...overrides,
});

async function owner() {
  const ownerId = await newUserId(connection.db);
  return {
    ownerId,
    write: await writeScope(ownerId),
    read: await readScope(ownerId),
    category: () => newCategory(connection.pool, ownerId, 'expense'),
  };
}

async function child(ownerId: string, parentId: string): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, parent_id, name, icon, color)
     values ($1, 'expense', $2, $3, 'wallet', 'blue') returning id`,
    [ownerId, parentId, `Sub ${randomUUID()}`],
  );
  return result.rows[0]?.id ?? '';
}

describe('DrizzleBudgetRepository', () => {
  it('stores a budget with two categories, default thresholds and rollover off, and lists it (AC-01, AC-07, AC-09)', async () => {
    const ana = await owner();
    const [a, b] = [await ana.category(), await ana.category()];
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([a, b]) },
      OCTOBER,
    );

    expect(created.currency).toBe('ARS');
    expect(created.ownerId).toBe(ana.ownerId);
    expect(created.version.thresholds).toEqual([80, 100]);
    expect(created.version.rollover).toBe(false);
    expect([...created.version.categoryIds].sort()).toEqual([a, b].sort());
    expect(await count('select count(*) as n from budget_versions')).toBe(1);
    const listed = await budgets.listCurrent(ana.read, OCTOBER);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(await budgets.findById(ana.read, created.id, OCTOBER)).toEqual(created);
  });

  it('covers the children of a selected parent, including one added later (AC-06)', async () => {
    const ana = await owner();
    const food = await ana.category();
    const first = await child(ana.ownerId, food);
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([food]) },
      OCTOBER,
    );
    expect([...created.coveredCategoryIds].sort()).toEqual([food, first].sort());

    const later = await child(ana.ownerId, food);
    const read = await budgets.findById(ana.read, created.id, OCTOBER);
    expect([...(read?.coveredCategoryIds ?? [])].sort()).toEqual([food, first, later].sort());
    expect(read?.version.categoryIds).toEqual([food]);
  });

  it('rejects a category of another user and stores nothing (AC-03)', async () => {
    const ana = await owner();
    const bea = await owner();
    const foreign = await bea.category();

    await expect(
      budgets.create(ana.write, { currency: 'ARS', version: versionOf([foreign]) }, OCTOBER),
    ).rejects.toThrow(ResourceNotFound);
    expect(await count('select count(*) as n from budgets')).toBe(0);
    expect(await count('select count(*) as n from budget_versions')).toBe(0);
  });

  it('rejects an income category (AC-04)', async () => {
    const ana = await owner();
    const income = await newCategory(connection.pool, ana.ownerId, 'income');

    await expect(
      budgets.create(ana.write, { currency: 'ARS', version: versionOf([income]) }, OCTOBER),
    ).rejects.toThrow();
    expect(await count('select count(*) as n from budgets')).toBe(0);
  });

  it('an October edit writes an October version and leaves September rows equal (AC-12, AC-14)', async () => {
    const ana = await owner();
    const cat = await ana.category();
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([cat]) },
      SEPTEMBER,
    );
    const snapshot = async () =>
      (
        await connection.pool.query<Record<string, unknown>>(
          `select v.id, v.name, v.amount::text, v.rollover, v.effective_from::text,
                  (select array_agg(category_id order by category_id) from budget_version_categories where version_id = v.id) as cats,
                  (select array_agg(percent order by percent) from budget_version_thresholds where version_id = v.id) as pcts
             from budget_versions v where v.budget_id = $1 and v.effective_from = $2`,
          [created.id, SEPTEMBER],
        )
      ).rows;
    const before = await snapshot();

    const updated = await budgets.update(ana.write, created.id, OCTOBER, () =>
      versionOf([cat], { effectiveFrom: OCTOBER, name: 'Food 2', amount: 20000000n }),
    );

    expect(updated?.version.effectiveFrom).toBe(OCTOBER);
    expect(updated?.version.amount).toBe(20000000n);
    expect(await snapshot()).toEqual(before);
    expect(await count('select count(*) as n from budget_versions')).toBe(2);
    const inSeptember = await budgets.findById(ana.read, created.id, SEPTEMBER);
    expect(inSeptember?.version.name).toBe('Food');
  });

  it('two edits in October leave one October version with the latest values (AC-13)', async () => {
    const ana = await owner();
    const cat = await ana.category();
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([cat]) },
      SEPTEMBER,
    );
    await budgets.update(ana.write, created.id, OCTOBER, () =>
      versionOf([cat], { effectiveFrom: OCTOBER, name: 'One', thresholds: [50] }),
    );
    const second = await budgets.update(ana.write, created.id, OCTOBER, () =>
      versionOf([cat], { effectiveFrom: OCTOBER, name: 'Two', thresholds: [90, 110] }),
    );

    expect(second?.version.name).toBe('Two');
    expect(second?.version.thresholds).toEqual([90, 110]);
    expect(
      await count('select count(*) as n from budget_versions where effective_from = $1', [OCTOBER]),
    ).toBe(1);
    expect(await count('select count(*) as n from budget_version_thresholds')).toBe(4);
  });

  it('an edit with a category of another user fails and leaves the budget unchanged (AC-16)', async () => {
    const ana = await owner();
    const bea = await owner();
    const cat = await ana.category();
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([cat]) },
      OCTOBER,
    );

    const foreign = await bea.category();
    await expect(
      budgets.update(ana.write, created.id, OCTOBER, () =>
        versionOf([foreign], { effectiveFrom: OCTOBER, name: 'Changed' }),
      ),
    ).rejects.toThrow(ResourceNotFound);

    expect(await budgets.findById(ana.read, created.id, OCTOBER)).toEqual(created);
  });

  it('answers nothing for reading, updating or deleting a budget of another user (AC-18, AC-19)', async () => {
    const ana = await owner();
    const bea = await owner();
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([await ana.category()]) },
      OCTOBER,
    );

    expect(await budgets.findById(bea.read, created.id, OCTOBER)).toBeNull();
    expect(await budgets.findById(bea.read, randomUUID(), OCTOBER)).toBeNull();
    expect(await budgets.listCurrent(bea.read, OCTOBER)).toEqual([]);
    const beaCategory = await bea.category();
    expect(
      await budgets.update(bea.write, created.id, OCTOBER, () => versionOf([beaCategory])),
    ).toBeNull();
    expect(await budgets.delete(bea.write, created.id)).toBe(false);
    expect(await budgets.findById(ana.read, created.id, OCTOBER)).not.toBeNull();
  });

  it('deleting removes versions, categories and thresholds and leaves categories alone (AC-17)', async () => {
    const ana = await owner();
    const cat = await ana.category();
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([cat]) },
      OCTOBER,
    );
    await budgets.update(ana.write, created.id, '2026-11-01', () =>
      versionOf([cat], { effectiveFrom: '2026-11-01' }),
    );
    const categoriesBefore = await count('select count(*) as n from categories');

    expect(await budgets.delete(ana.write, created.id)).toBe(true);

    for (const table of BUDGET_TABLES) {
      expect(await count(`select count(*) as n from ${table}`)).toBe(0);
    }
    expect(await count('select count(*) as n from categories')).toBe(categoriesBefore);
    expect(await budgets.delete(ana.write, created.id)).toBe(false);
  });

  it('20 concurrent creates at 40 budgets: exactly 10 succeed, 10 hit the limit (AC-23)', async () => {
    const ana = await owner();
    const cat = await ana.category();
    for (let i = 0; i < 40; i += 1) {
      await budgets.create(ana.write, { currency: 'ARS', version: versionOf([cat]) }, OCTOBER);
    }

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        budgets.create(ana.write, { currency: 'ARS', version: versionOf([cat]) }, OCTOBER),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(10);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(BudgetLimitReached);
    expect(
      await count('select count(*) as n from budgets where owner_id = $1', [ana.ownerId]),
    ).toBe(50);
  });

  it('allows a create after a delete at 50 budgets (AC-24)', async () => {
    const ana = await owner();
    const cat = await ana.category();
    const ids: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const made = await budgets.create(
        ana.write,
        { currency: 'ARS', version: versionOf([cat]) },
        OCTOBER,
      );
      ids.push(made.id);
    }
    await expect(
      budgets.create(ana.write, { currency: 'ARS', version: versionOf([cat]) }, OCTOBER),
    ).rejects.toThrow(BudgetLimitReached);

    expect(await budgets.delete(ana.write, ids[0] ?? '')).toBe(true);

    await expect(
      budgets.create(ana.write, { currency: 'ARS', version: versionOf([cat]) }, OCTOBER),
    ).resolves.toBeDefined();
  });

  it('stores 150,000.00 ARS as 15000000 and round-trips the largest int64 (AC-21)', async () => {
    const ana = await owner();
    const cat = await ana.category();
    const normal = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([cat]) },
      OCTOBER,
    );
    const huge = await budgets.create(
      ana.write,
      { currency: 'USD', version: versionOf([cat], { amount: INT64_MAX }) },
      OCTOBER,
    );

    const stored = await connection.pool.query<Record<string, unknown>>(
      'select amount::text from budget_versions where budget_id = $1',
      [normal.id],
    );
    expect(stored.rows[0]).toEqual({ amount: '15000000' });
    expect((await budgets.findById(ana.read, normal.id, OCTOBER))?.version.amount).toBe(15000000n);
    expect((await budgets.findById(ana.read, huge.id, OCTOBER))?.version.amount).toBe(INT64_MAX);
  });

  it('refuses to delete a category a budget uses, and deleting the user removes the budgets (AC-17)', async () => {
    const ana = await owner();
    const cat = await ana.category();
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([cat]) },
      OCTOBER,
    );

    await expect(
      connection.pool.query('delete from categories where id = $1', [cat]),
    ).rejects.toMatchObject({ code: '23503' });
    expect(await budgets.findById(ana.read, created.id, OCTOBER)).not.toBeNull();

    await connection.pool.query('delete from users where id = $1', [ana.ownerId]);
    for (const table of BUDGET_TABLES) {
      expect(await count(`select count(*) as n from ${table}`)).toBe(0);
    }
  });

  it('shows a budget whose first version starts later with that first version', async () => {
    const ana = await owner();
    const created = await budgets.create(
      ana.write,
      { currency: 'ARS', version: versionOf([await ana.category()], { effectiveFrom: OCTOBER }) },
      OCTOBER,
    );

    expect((await budgets.findById(ana.read, created.id, SEPTEMBER))?.version.effectiveFrom).toBe(
      OCTOBER,
    );
  });
});
