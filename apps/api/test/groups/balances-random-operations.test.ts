import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  balancesByCurrency,
  consolidate,
  pairLegs,
  type BalancesByCurrency,
} from '../../src/groups';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  equalSplit,
  insertExpensesSql,
  newDbWorld,
  plainSettlement,
  seededRandom,
} from './settlement-db-world';

/** NFR-02 on PostgreSQL: 10,000 seeded random operations keep every currency at sum 0. */

const OPERATIONS = 10_000;
const CHECK_EVERY = 500;
const CURRENCIES = ['ARS', 'USD'] as const;

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function sumOf(balances: BalancesByCurrency, currency: 'ARS' | 'USD'): bigint {
  let total = 0n;
  for (const value of balances[currency].values()) total += value;
  return total;
}

describe('random operations on PostgreSQL', () => {
  it('leaves the sum of balances at 0 in each currency after 10,000 operations and matches an independent ledger', async () => {
    const w = await newDbWorld(connection.db, connection.pool, { ghosts: 7 });
    const repository = new DrizzleGroupSettlementRepository(connection.db);
    const random = seededRandom(20261010);
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
    const ledger = {
      ARS: new Map<string, bigint>(),
      USD: new Map<string, bigint>(),
    };
    const move = (currency: 'ARS' | 'USD', memberId: string, delta: bigint) =>
      ledger[currency].set(memberId, (ledger[currency].get(memberId) ?? 0n) + delta);
    const counts = { expense: 0, plain: 0, consolidated: 0 };

    for (let op = 1; op <= OPERATIONS; op += 1) {
      const kind = random();
      const currency = pick(CURRENCIES);
      if (kind < 0.55) {
        const size = int(2, w.memberIds.length);
        const sharers = [...w.memberIds].sort(() => random() - 0.5).slice(0, size);
        const amount = BigInt(int(100, 10_000_000));
        const payer = pick(w.memberIds);
        const shares = equalSplit(amount, sharers);
        await insertExpensesSql(connection.pool, w, [{ payer, amount, currency, shares }]);
        move(currency, payer, amount);
        for (const share of shares) move(currency, share.memberId, -share.amount);
        counts.expense += 1;
      } else if (kind < 0.95) {
        const from = pick(w.memberIds);
        const to = pick(w.memberIds.filter((id) => id !== from));
        const amount = BigInt(int(1, 5_000_000));
        await repository.saveSettlement(
          plainSettlement(w, {
            fromMemberId: from,
            toMemberId: to,
            currency,
            amount,
            legs: [{ currency, amount }],
          }),
        );
        move(currency, from, amount);
        move(currency, to, -amount);
        counts.plain += 1;
      } else {
        const a = pick(w.memberIds);
        const b = pick(w.memberIds.filter((id) => id !== a));
        const balances = balancesByCurrency(await repository.readBalanceSources(w.groupId));
        const legs = pairLegs(balances, a, b);
        if (legs.ARS === 0n || legs.USD === 0n) continue;
        const rate = BigInt(int(5_000_000, 20_000_000));
        const result = consolidate(a, b, legs, currency, rate);
        await repository.saveSettlement(
          plainSettlement(w, {
            fromMemberId: result.fromMemberId,
            toMemberId: result.toMemberId,
            currency: result.currency,
            amount: result.amount,
            legs: result.legs,
            rate: { value: rate, source: 'manual', type: null },
            consolidation: { memberIds: [a, b], legs },
          }),
        );
        for (const leg of result.legs) {
          move(leg.currency, result.fromMemberId, leg.amount);
          move(leg.currency, result.toMemberId, -leg.amount);
        }
        counts.consolidated += 1;
      }
      if (op % CHECK_EVERY === 0) {
        const balances = balancesByCurrency(await repository.readBalanceSources(w.groupId));
        expect(sumOf(balances, 'ARS')).toBe(0n);
        expect(sumOf(balances, 'USD')).toBe(0n);
      }
    }

    const final = balancesByCurrency(await repository.readBalanceSources(w.groupId));
    for (const currency of CURRENCIES) {
      expect(sumOf(final, currency)).toBe(0n);
      for (const memberId of w.memberIds) {
        expect(final[currency].get(memberId) ?? 0n).toBe(ledger[currency].get(memberId) ?? 0n);
      }
    }
    expect(counts.expense).toBeGreaterThan(4_000);
    expect(counts.plain).toBeGreaterThan(2_000);
    expect(counts.consolidated).toBeGreaterThan(0);
  }, 600_000);
});
