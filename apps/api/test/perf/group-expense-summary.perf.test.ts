import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SummarizeGroupExpenses } from '../../src/groups';
import { DrizzleGroupExpenseSummaryReader } from '../../src/groups/infrastructure/db/drizzle-group-expense-summary-reader';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newDbWorld, seededRandom } from '../groups/settlement-db-world';
import { addCategory, seedExpenses, type SeedExpense } from '../groups/summary-db-seed';

/**
 * NFR-04 of DISC-001-05j: the summary use case (membership check, aggregate and category read)
 * of a group with 5,000 expenses answers in under 300 ms at p95 over 20 runs. Run it alone with
 * `pnpm --filter ./apps/api test:perf group-expense-summary`.
 */
const EXPENSES = 5_000;
const RUNS = 20;
const MAX_P95_MS = 300;
const FROM = new Date('2026-10-01T03:00:00.000Z');
const TO = new Date('2026-10-31T02:59:59.999Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

describe('group expense summary latency (NFR-04)', () => {
  it('keeps p95 of 20 summaries over 5,000 expenses below 300 ms', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 3 });
    const categories = [w.categoryId];
    for (let i = 0; i < 9; i += 1) {
      categories.push(await addCategory(connection.pool, w.groupId, `Perf ${i}`));
    }
    const random = seededRandom(5011);
    const int = (max: number) => Math.floor(random() * max);
    const expenses: SeedExpense[] = Array.from({ length: EXPENSES }, (_, i) => ({
      currency: i % 3 === 0 ? ('USD' as const) : ('ARS' as const),
      categoryId: categories[int(categories.length)] ?? w.categoryId,
      amount: BigInt(1_000 + int(10_000_000)),
      // Spread over 120 days so the range covers a part of the table.
      occurredAt: new Date(TO.getTime() - int(120 * DAY_MS)),
    }));
    for (let start = 0; start < expenses.length; start += 1_000) {
      await seedExpenses(connection.pool, w, expenses.slice(start, start + 1_000));
    }
    await connection.pool.query('analyze group_expenses');
    const summarize = new SummarizeGroupExpenses({
      groups: new DrizzleGroupRepository(connection.db),
      summaries: new DrizzleGroupExpenseSummaryReader(connection.db),
    });

    const latencies: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const result = await summarize.execute(w.userId, w.groupId, {
        from: FROM.toISOString(),
        to: TO.toISOString(),
      });
      latencies.push(performance.now() - started);
      expect(result.currencies.length).toBeGreaterThan(0);
    }

    const p95 = percentile(latencies, 95);
    console.info(
      `group expense summary (${EXPENSES} expenses): p50=${percentile(latencies, 50).toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${Math.max(...latencies).toFixed(1)}ms`,
    );
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 300_000);
});
