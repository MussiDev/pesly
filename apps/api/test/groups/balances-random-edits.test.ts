import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  balancesByCurrency,
  consolidate,
  expenseSnapshot,
  pairLegs,
  settlementSnapshot,
  type BalancesByCurrency,
  type GroupExpense,
  type GroupSettlement,
} from '../../src/groups';
import { DrizzleGroupExpenseRepository } from '../../src/groups/infrastructure/db/drizzle-group-expense-repository';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  equalSplit,
  HOUR,
  insertExpensesSql,
  newDbWorld,
  NOW,
  plainSettlement,
  seededRandom,
} from './settlement-db-world';

/**
 * AC-05 and AC-06 on PostgreSQL: 10,000 seeded random operations that create, edit and delete
 * expenses and settlements keep every currency at sum 0, match an independent ledger and add
 * exactly one log row per successful write made through the repositories.
 */

const OPERATIONS = 10_000;
const CHECK_EVERY = 500;
const CURRENCIES = ['ARS', 'USD'] as const;
type Currency = (typeof CURRENCIES)[number];

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function sumOf(balances: BalancesByCurrency, currency: Currency): bigint {
  let total = 0n;
  for (const value of balances[currency].values()) total += value;
  return total;
}

async function logCount(groupId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from group_activity_log where group_id = $1',
    [groupId],
  );
  return Number(result.rows[0]?.n);
}

describe('random creates, edits and deletes on PostgreSQL', () => {
  it('keeps the sum of balances at 0 in each currency, matches an independent ledger and logs every write once', async () => {
    const started = Date.now();
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 4 });
    const recorder = new DrizzlePayerMovementRecorder(connection.db, { now: () => NOW });
    const expenses = new DrizzleGroupExpenseRepository(connection.db, recorder);
    const settlements = new DrizzleGroupSettlementRepository(connection.db);
    const random = seededRandom(20261011);
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
    const ledger = { ARS: new Map<string, bigint>(), USD: new Map<string, bigint>() };
    const move = (currency: Currency, memberId: string, delta: bigint) =>
      ledger[currency].set(memberId, (ledger[currency].get(memberId) ?? 0n) + delta);
    const applyExpense = (e: GroupExpense, sign: 1n | -1n) => {
      move(e.currency, e.payerMemberId, e.amount * sign);
      for (const share of e.shares) move(e.currency, share.memberId, -share.amount * sign);
    };
    const applySettlement = (s: GroupSettlement, sign: 1n | -1n) => {
      for (const leg of s.legs) {
        move(leg.currency, s.fromMemberId, leg.amount * sign);
        move(leg.currency, s.toMemberId, -leg.amount * sign);
      }
    };

    const liveExpenses: GroupExpense[] = [];
    const livePlain: GroupSettlement[] = [];
    const liveConsolidated: GroupSettlement[] = [];
    const removeAt = <T>(items: T[], index: number): T => {
      const [item] = items.splice(index, 1);
      return item as T;
    };
    const counts = {
      createExpense: 0,
      sqlExpense: 0,
      editExpense: 0,
      deleteExpense: 0,
      createPlain: 0,
      editPlain: 0,
      deletePlain: 0,
      createConsolidated: 0,
      deleteConsolidated: 0,
    };
    let successfulWrites = 0;

    const sharersFor = (amountLimit: number) => {
      const size = int(2, Math.min(w.memberIds.length, amountLimit));
      return [...w.memberIds].sort(() => random() - 0.5).slice(0, size);
    };
    const exactShares = (amount: bigint) =>
      equalSplit(amount, sharersFor(5)).map((s) => ({ ...s, basisPoints: null }));

    async function assertConsistent(): Promise<void> {
      const balances = balancesByCurrency(await settlements.readBalanceSources(w.groupId));
      for (const currency of CURRENCIES) {
        expect(sumOf(balances, currency)).toBe(0n);
        for (const memberId of w.memberIds) {
          expect(balances[currency].get(memberId) ?? 0n).toBe(ledger[currency].get(memberId) ?? 0n);
        }
      }
      expect(await logCount(w.groupId)).toBe(successfulWrites);
    }

    for (let op = 1; op <= OPERATIONS; op += 1) {
      const kind = random();
      const at = new Date(NOW.getTime() + op);
      const currency = pick(CURRENCIES);

      if (kind < 0.12) {
        // Direct SQL bulk insert, as in 05c: no log row, so it is not counted as a write.
        const amount = BigInt(int(100, 10_000_000));
        const payer = pick(w.memberIds);
        const shares = equalSplit(amount, sharersFor(5));
        await insertExpensesSql(connection.pool, w, [{ payer, amount, currency, shares }]);
        move(currency, payer, amount);
        for (const share of shares) move(currency, share.memberId, -share.amount);
        counts.sqlExpense += 1;
      } else if (kind < 0.3) {
        const amount = BigInt(int(100, 10_000_000));
        const saved = await expenses.saveExpense({
          groupId: w.groupId,
          payerMemberId: pick(w.memberIds),
          createdByMemberId: w.anaMember,
          amount,
          currency,
          occurredAt: new Date(NOW.getTime() - HOUR),
          categoryId: w.categoryId,
          description: `Expense ${op}`,
          splitMode: 'exact',
          shares: exactShares(amount),
          activity: { action: 'expense_created', memberId: w.anaMember, createdAt: at },
          payerMovement: null,
        });
        applyExpense(saved, 1n);
        liveExpenses.push(saved);
        counts.createExpense += 1;
        successfulWrites += 1;
      } else if (kind < 0.43 && liveExpenses.length > 0) {
        const index = int(0, liveExpenses.length - 1);
        const stored = liveExpenses[index] as GroupExpense;
        const amount = BigInt(int(100, 10_000_000));
        const shares = exactShares(amount);
        const occurredAt = new Date(NOW.getTime() - int(2, 40) * HOUR);
        const description = `Edited ${op}`;
        const updated = await expenses.updateExpense({
          groupId: w.groupId,
          expenseId: stored.id,
          amount,
          occurredAt,
          categoryId: stored.categoryId,
          description,
          splitMode: 'exact',
          shares,
          rateType: 'mep',
          activity: {
            action: 'expense_updated',
            memberId: w.anaMember,
            createdAt: at,
            before: expenseSnapshot(stored),
            after: expenseSnapshot({
              ...stored,
              amount,
              occurredAt,
              description,
              splitMode: 'exact',
              shares,
            }),
          },
        });
        applyExpense(stored, -1n);
        applyExpense(updated, 1n);
        liveExpenses[index] = updated;
        counts.editExpense += 1;
        successfulWrites += 1;
      } else if (kind < 0.53 && liveExpenses.length > 0) {
        const stored = removeAt(liveExpenses, int(0, liveExpenses.length - 1));
        await expenses.deleteExpense({
          groupId: w.groupId,
          expenseId: stored.id,
          rateType: 'mep',
          activity: {
            action: 'expense_deleted',
            memberId: w.anaMember,
            createdAt: at,
            before: expenseSnapshot(stored),
            after: null,
          },
        });
        applyExpense(stored, -1n);
        counts.deleteExpense += 1;
        successfulWrites += 1;
      } else if (kind < 0.73) {
        const from = pick(w.memberIds);
        const to = pick(w.memberIds.filter((id) => id !== from));
        const amount = BigInt(int(1, 5_000_000));
        const saved = await settlements.saveSettlement(
          plainSettlement(w, {
            fromMemberId: from,
            toMemberId: to,
            currency,
            amount,
            legs: [{ currency, amount }],
            activity: { action: 'settlement_created', memberId: w.anaMember, createdAt: at },
          }),
        );
        applySettlement(saved, 1n);
        livePlain.push(saved);
        counts.createPlain += 1;
        successfulWrites += 1;
      } else if (kind < 0.82 && livePlain.length > 0) {
        const index = int(0, livePlain.length - 1);
        const stored = livePlain[index] as GroupSettlement;
        const amount = BigInt(int(1, 5_000_000));
        const occurredAt = new Date(NOW.getTime() - int(2, 40) * HOUR);
        const legs = [{ currency: stored.currency, amount }];
        const updated = await settlements.updateSettlement({
          groupId: w.groupId,
          settlementId: stored.id,
          amount,
          occurredAt,
          legs,
          activity: {
            action: 'settlement_updated',
            memberId: w.anaMember,
            createdAt: at,
            before: settlementSnapshot(stored),
            after: settlementSnapshot({ ...stored, amount, occurredAt, legs }),
          },
        });
        applySettlement(stored, -1n);
        applySettlement(updated, 1n);
        livePlain[index] = updated;
        counts.editPlain += 1;
        successfulWrites += 1;
      } else if (kind < 0.9 && livePlain.length > 0) {
        const stored = removeAt(livePlain, int(0, livePlain.length - 1));
        await settlements.deleteSettlement({
          groupId: w.groupId,
          settlementId: stored.id,
          activity: {
            action: 'settlement_deleted',
            memberId: w.anaMember,
            createdAt: at,
            before: settlementSnapshot(stored),
            after: null,
          },
        });
        applySettlement(stored, -1n);
        counts.deletePlain += 1;
        successfulWrites += 1;
      } else if (kind < 0.96) {
        const a = pick(w.memberIds);
        const b = pick(w.memberIds.filter((id) => id !== a));
        const balances = balancesByCurrency(await settlements.readBalanceSources(w.groupId));
        const legs = pairLegs(balances, a, b);
        if (legs.ARS !== 0n && legs.USD !== 0n) {
          const rate = BigInt(int(5_000_000, 20_000_000));
          const result = consolidate(a, b, legs, currency, rate);
          const saved = await settlements.saveSettlement(
            plainSettlement(w, {
              fromMemberId: result.fromMemberId,
              toMemberId: result.toMemberId,
              currency: result.currency,
              amount: result.amount,
              legs: result.legs,
              rate: { value: rate, source: 'manual', type: null },
              consolidation: { memberIds: [a, b], legs },
              activity: { action: 'settlement_created', memberId: w.anaMember, createdAt: at },
            }),
          );
          applySettlement(saved, 1n);
          liveConsolidated.push(saved);
          counts.createConsolidated += 1;
          successfulWrites += 1;
        }
      } else if (liveConsolidated.length > 0) {
        const stored = removeAt(liveConsolidated, int(0, liveConsolidated.length - 1));
        await settlements.deleteSettlement({
          groupId: w.groupId,
          settlementId: stored.id,
          activity: {
            action: 'settlement_deleted',
            memberId: w.anaMember,
            createdAt: at,
            before: settlementSnapshot(stored),
            after: null,
          },
        });
        applySettlement(stored, -1n);
        counts.deleteConsolidated += 1;
        successfulWrites += 1;
      }

      if (op % CHECK_EVERY === 0) await assertConsistent();
    }

    await assertConsistent();
    console.info(
      `balances-random-edits: ${OPERATIONS} operations, ${successfulWrites} logged writes in ${
        Date.now() - started
      } ms`,
      JSON.stringify(counts),
    );
    for (const [name, value] of Object.entries(counts)) expect(value, name).toBeGreaterThan(0);
    expect(successfulWrites).toBeGreaterThan(5_000);
  }, 600_000);
});
