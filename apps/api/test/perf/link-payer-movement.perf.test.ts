import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LinkPayerMovement, ListMovementCandidates } from '../../src/groups';
import { DrizzleGroupExpenseRepository } from '../../src/groups/infrastructure/db/drizzle-group-expense-repository';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from '../movements/db-fixtures';
import { newDbWorld, seededRandom } from '../groups/settlement-db-world';
import { seedExpenses, type SeedExpense } from '../groups/summary-db-seed';

/**
 * NFR-02 of FEAT-008: linking an expense to the payer account and listing the candidates answer in
 * under 300 ms at p95 over 20 runs, in a group with 10,000 expenses and a payer with 3,000
 * movements. Run it alone with `pnpm --filter ./apps/api test:perf link-payer-movement`.
 */
const EXPENSES = 10_000;
const PAYER_MOVEMENTS = 3_000;
const TARGET_AMOUNT = 4_000_000n;
const TARGETS = 25;
const RUNS = 20;
const MAX_P95_MS = 300;
const NOW = new Date('2026-10-10T12:00:00.000Z');
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

describe('link payer movement latency (NFR-02)', () => {
  it('keeps p95 of 20 links and 20 candidate lists below 300 ms with 10,000 expenses in the group', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 3 });
    await connection.pool.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ('mep', 12900000, 13000000, now(), now())`,
    );
    const random = seededRandom(8008);
    const int = (max: number) => Math.floor(random() * max);
    const expenses: SeedExpense[] = Array.from({ length: EXPENSES }, (_, i) => ({
      currency: 'ARS' as const,
      categoryId: w.categoryId,
      amount: i < TARGETS ? TARGET_AMOUNT : BigInt(1_000 + int(10_000_000)),
      occurredAt: new Date(NOW.getTime() - int(120 * DAY_MS) - DAY_MS),
    }));
    for (let start = 0; start < expenses.length; start += 1_000) {
      await seedExpenses(connection.pool, w, expenses.slice(start, start + 1_000));
    }
    const accountId = await newAccount(connection.pool, w.userId, false, 'ARS');
    const personalCategoryId = await newCategory(connection.pool, w.userId, 'expense');
    await connection.pool.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       select $1, 'expense', $2, $3, case when g % 100 = 0 then $4::bigint else 1000 + g end,
              $5::timestamptz - (g || ' hours')::interval, 14000000, 'manual'
       from generate_series(1, $6::int) g`,
      [
        w.userId,
        accountId,
        personalCategoryId,
        TARGET_AMOUNT.toString(),
        NOW.toISOString(),
        PAYER_MOVEMENTS,
      ],
    );
    await connection.pool.query('analyze group_expenses');
    await connection.pool.query('analyze movements');
    const targets = await connection.pool.query<{ id: string }>(
      'select id from group_expenses where group_id = $1 and amount = $2 order by id limit $3',
      [w.groupId, TARGET_AMOUNT.toString(), RUNS + 1],
    );
    const ids = targets.rows.map((row) => row.id);
    expect(ids.length).toBeGreaterThan(RUNS);

    const groups = new DrizzleGroupRepository(connection.db);
    const recorder = new DrizzlePayerMovementRecorder(connection.db, { now: () => NOW });
    const repository = new DrizzleGroupExpenseRepository(connection.db, recorder);
    const link = new LinkPayerMovement({ groups, expenses: repository, payerMovements: recorder });
    const candidates = new ListMovementCandidates({
      groups,
      expenses: repository,
      payerMovements: recorder,
    });

    const candidateLatencies: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const rows = await candidates.execute(w.userId, w.groupId, ids[0] ?? '');
      candidateLatencies.push(performance.now() - started);
      expect(rows.length).toBeGreaterThan(0);
    }
    const linkLatencies: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const linked = await link.execute(w.userId, w.groupId, ids[run + 1] ?? '', {
        mode: 'create',
        accountId,
        categoryId: personalCategoryId,
      });
      linkLatencies.push(performance.now() - started);
      expect(linked.payerMovementId).not.toBeNull();
    }

    const linkP95 = percentile(linkLatencies, 95);
    const candidatesP95 = percentile(candidateLatencies, 95);
    console.info(
      `link payer movement (${EXPENSES} expenses): link p95=${linkP95.toFixed(1)}ms candidates p95=${candidatesP95.toFixed(1)}ms`,
    );
    expect(linkP95).toBeLessThan(MAX_P95_MS);
    expect(candidatesP95).toBeLessThan(MAX_P95_MS);
  }, 300_000);
});
