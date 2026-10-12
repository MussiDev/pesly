import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SummarizeGroupExpenses } from '../../src/groups';
import { DrizzleGroupExpenseSummaryReader } from '../../src/groups/infrastructure/db/drizzle-group-expense-summary-reader';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newDbWorld, seededRandom } from './settlement-db-world';
import { addCategory, seedExpenses, type SeedExpense } from './summary-db-seed';

let connection: DatabaseConnection;
let reader: DrizzleGroupExpenseSummaryReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleGroupExpenseSummaryReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const FROM = new Date('2026-10-01T03:00:00.000Z');
const TO = new Date('2026-10-31T02:59:59.999Z');
const INSIDE = new Date('2026-10-15T12:00:00.000Z');

describe('DrizzleGroupExpenseSummaryReader', () => {
  it('sums per currency and category as bigint, counts every row, and scopes by group and range (AC-26)', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 0 });
    const other = await newDbWorld(connection.db, connection.pool, { ghosts: 0 });
    const second = await addCategory(connection.pool, w.groupId, 'Otros');
    const huge = 9_000_000_000_000_000n;
    await seedExpenses(connection.pool, w, [
      { currency: 'ARS', categoryId: w.categoryId, amount: huge, occurredAt: INSIDE },
      { currency: 'ARS', categoryId: w.categoryId, amount: huge, occurredAt: FROM },
      { currency: 'ARS', categoryId: w.categoryId, amount: 5n, occurredAt: TO },
      { currency: 'USD', categoryId: second, amount: 700n, occurredAt: INSIDE },
      { currency: 'ARS', categoryId: second, amount: 1n, occurredAt: new Date(FROM.getTime() - 1) },
      { currency: 'ARS', categoryId: second, amount: 1n, occurredAt: new Date(TO.getTime() + 1) },
    ]);
    await seedExpenses(connection.pool, other, [
      { currency: 'ARS', categoryId: other.categoryId, amount: 999n, occurredAt: INSIDE },
    ]);

    const rows = await reader.summarize(w.groupId, { from: FROM, to: TO });

    const byKey = new Map(rows.map((row) => [`${row.currency}/${row.categoryId}`, row]));
    expect(rows).toHaveLength(2);
    expect(byKey.get(`ARS/${w.categoryId}`)).toEqual({
      currency: 'ARS',
      categoryId: w.categoryId,
      total: huge * 2n + 5n,
      count: 3,
    });
    expect(byKey.get(`USD/${second}`)).toEqual({
      currency: 'USD',
      categoryId: second,
      total: 700n,
      count: 1,
    });
  });

  it('counts more than 50 expenses, not a page (AC-26)', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 0 });
    await seedExpenses(
      connection.pool,
      w,
      Array.from({ length: 120 }, () => ({
        currency: 'ARS' as const,
        categoryId: w.categoryId,
        amount: 10n,
        occurredAt: INSIDE,
      })),
    );

    const rows = await reader.summarize(w.groupId, { from: FROM, to: TO });

    expect(rows).toEqual([
      { currency: 'ARS', categoryId: w.categoryId, total: 1_200n, count: 120 },
    ]);
  });

  it('returns no rows for a range without expenses (AC-16)', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 0 });

    expect(await reader.summarize(w.groupId, { from: FROM, to: TO })).toEqual([]);
  });

  it('keeps the lines equal to the total and the total equal to an independent sum over 1,000 random sets (NFR-03, AC-26)', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 0 });
    const categories = [
      w.categoryId,
      await addCategory(connection.pool, w.groupId, 'Uno'),
      await addCategory(connection.pool, w.groupId, 'Dos'),
    ];
    const summarize = new SummarizeGroupExpenses({
      groups: new DrizzleGroupRepository(connection.db),
      summaries: reader,
    });
    const random = seededRandom(5010);
    const int = (max: number) => Math.floor(random() * max);

    for (let round = 0; round < 1_000; round += 1) {
      await connection.pool.query('delete from group_expenses where group_id = $1', [w.groupId]);
      const expenses: SeedExpense[] = Array.from({ length: int(16) }, () => {
        const outside = int(5) === 0;
        return {
          currency: int(2) === 0 ? ('ARS' as const) : ('USD' as const),
          categoryId: categories[int(3)] ?? w.categoryId,
          amount: BigInt(1 + int(1_000_000_000)) * BigInt(1 + int(1_000_000)),
          occurredAt: outside ? new Date(TO.getTime() + 1 + int(1_000_000)) : INSIDE,
        };
      });
      await seedExpenses(connection.pool, w, expenses);

      const result = await summarize.execute(w.userId, w.groupId, {
        from: FROM.toISOString(),
        to: TO.toISOString(),
      });

      for (const currency of ['ARS', 'USD'] as const) {
        const inRange = expenses.filter((e) => e.currency === currency && e.occurredAt <= TO);
        const entry = result.currencies.find((c) => c.currency === currency);
        if (inRange.length === 0) {
          expect(entry).toBeUndefined();
          continue;
        }
        const independent = inRange.reduce((sum, e) => sum + e.amount, 0n);
        expect(entry?.total).toBe(independent);
        expect(entry?.categories.reduce((sum, line) => sum + line.total, 0n)).toBe(independent);
        expect(entry?.count).toBe(inRange.length);
        expect(entry?.categories.reduce((sum, line) => sum + line.count, 0)).toBe(inRange.length);
      }
    }
  }, 120_000);
});
