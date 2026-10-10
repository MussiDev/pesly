import { describe, expect, it } from 'vitest';
import { simplifyDebts, type DebtPayment } from '../src/money/simplify-debts';

/** Seeded integer PRNG (64-bit LCG, bigint only): no floats, reproducible. */
function createRng(seed: bigint): (bound: bigint) => bigint {
  let state = seed;
  return (bound) => {
    state = (state * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    return (state >> 16n) % bound;
  };
}

function apply(balances: Map<string, bigint>, payments: readonly DebtPayment[]) {
  const result = new Map(balances);
  for (const { from, to, amount } of payments) {
    result.set(from, (result.get(from) ?? 0n) + amount);
    result.set(to, (result.get(to) ?? 0n) - amount);
  }
  return result;
}

describe('simplifyDebts', () => {
  it('turns A owes B 100.00 and B owes C 100.00 into one payment A to C (AC-03)', () => {
    const balances = new Map([
      ['A', -10_000n],
      ['B', 0n],
      ['C', 10_000n],
    ]);
    expect(simplifyDebts(balances)).toEqual([{ from: 'A', to: 'C', amount: 10_000n }]);
  });

  it('gives no payments when every balance is 0 (AC-04)', () => {
    expect(
      simplifyDebts(
        new Map([
          ['A', 0n],
          ['B', 0n],
        ]),
      ),
    ).toEqual([]);
    expect(simplifyDebts(new Map())).toEqual([]);
  });

  it('matches equal-amount debtor and creditor pairs first', () => {
    const balances = new Map([
      ['d1', -700n],
      ['d2', -300n],
      ['c1', 600n],
      ['c2', 300n],
      ['c3', 100n],
    ]);
    expect(simplifyDebts(balances)).toEqual([
      { from: 'd2', to: 'c2', amount: 300n },
      { from: 'd1', to: 'c1', amount: 600n },
      { from: 'd1', to: 'c3', amount: 100n },
    ]);
  });

  it('is deterministic whatever the insertion order of the map', () => {
    const entries: [string, bigint][] = [
      ['b', -500n],
      ['a', -500n],
      ['d', 400n],
      ['c', 600n],
    ];
    const first = simplifyDebts(new Map(entries));
    const second = simplifyDebts(new Map([...entries].reverse()));
    expect(second).toEqual(first);
  });

  it('throws when the balances do not add up to 0', () => {
    expect(() =>
      simplifyDebts(
        new Map([
          ['A', -100n],
          ['B', 50n],
        ]),
      ),
    ).toThrow();
  });

  it('property: 10,000 seeded zero-sum sets are cleared with at most non-zero members minus 1 payments (NFR-02)', () => {
    const rng = createRng(20261010n);
    for (let run = 0; run < 10_000; run += 1) {
      const count = Number(rng(12n)) + 2;
      const balances = new Map<string, bigint>();
      let total = 0n;
      for (let i = 0; i < count - 1; i += 1) {
        const value = rng(2_000_001n) - 1_000_000n;
        balances.set(`m${String(i).padStart(2, '0')}`, value);
        total += value;
      }
      balances.set(`m${String(count - 1).padStart(2, '0')}`, -total);

      const payments = simplifyDebts(balances);
      for (const balance of apply(balances, payments).values()) expect(balance).toBe(0n);
      const nonZero = [...balances.values()].filter((value) => value !== 0n).length;
      expect(payments.length).toBeLessThanOrEqual(Math.max(nonZero - 1, 0));
      for (const payment of payments) {
        expect(payment.amount).toBeGreaterThan(0n);
        expect(payment.from).not.toBe(payment.to);
      }
    }
  });
});
