import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetBalances } from '../../src/groups';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  equalSplit,
  insertExpensesSql,
  newDbWorld,
  plainSettlement,
  seededRandom,
  type SqlExpense,
} from '../groups/settlement-db-world';

/**
 * NFR-03 of DISC-001-05c: the `GetBalances` use case (membership check, group read, balance
 * aggregates and debt simplification) of a group with 50 members and 10,000 expenses
 * answers in under 500 ms at p95 over 20 runs. Run it alone with
 * `pnpm --filter ./apps/api test:perf group-balances`.
 */
const MEMBERS = 50;
const EXPENSES = 10_000;
const SHARERS = 10;
const SETTLEMENTS = 500;
const RUNS = 20;
const MAX_P95_MS = 500;
const CHUNK = 1_000;

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

describe('group balances latency (NFR-03)', () => {
  it('keeps p95 of 20 balance reads with 50 members and 10,000 expenses below 500 ms', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: MEMBERS - 1 });
    const repository = new DrizzleGroupSettlementRepository(connection.db);
    const getBalances = new GetBalances({
      groups: new DrizzleGroupRepository(connection.db),
      settlements: repository,
    });
    const random = seededRandom(5003);
    const int = (max: number) => Math.floor(random() * max);
    const expenses: SqlExpense[] = [];
    for (let i = 0; i < EXPENSES; i += 1) {
      const start = int(MEMBERS);
      const sharers = Array.from(
        { length: SHARERS },
        (_, k) => w.memberIds[(start + k) % MEMBERS] ?? '',
      );
      const amount = BigInt(1_000 + int(10_000_000));
      expenses.push({
        payer: w.memberIds[int(MEMBERS)] ?? '',
        amount,
        currency: i % 3 === 0 ? 'USD' : 'ARS',
        shares: equalSplit(amount, sharers),
      });
    }
    for (let start = 0; start < expenses.length; start += CHUNK) {
      await insertExpensesSql(connection.pool, w, expenses.slice(start, start + CHUNK));
    }
    for (let i = 0; i < SETTLEMENTS; i += 1) {
      const from = w.memberIds[int(MEMBERS)] ?? '';
      const to = w.memberIds[(w.memberIds.indexOf(from) + 1 + int(MEMBERS - 1)) % MEMBERS] ?? '';
      await repository.saveSettlement(
        plainSettlement(w, { fromMemberId: from, toMemberId: to, amount: BigInt(100 + i) }),
      );
    }
    await connection.pool.query(
      'analyze group_expenses, group_expense_shares, group_settlement_legs',
    );

    const latencies: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const balances = await getBalances.execute(w.userId, w.groupId);
      latencies.push(performance.now() - started);
      expect(balances.ARS.members).toHaveLength(MEMBERS);
    }

    const p95 = percentile(latencies, 95);
    console.info(
      `group balances (${MEMBERS} members, ${EXPENSES} expenses): p50=${percentile(latencies, 50).toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${Math.max(...latencies).toFixed(1)}ms`,
    );
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 300_000);
});
