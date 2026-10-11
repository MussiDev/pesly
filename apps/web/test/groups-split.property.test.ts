import { describe, expect, it } from 'vitest';
import {
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  splitByBasisPoints,
  splitEqual,
  splitSchema,
  validateExactSplit,
} from '@pesly/shared';
import { createSplitState, type SplitState } from '../src/features/groups/split/split-state';
import { buildSplit } from '../src/features/groups/split/split-request';

const CASES = 1_000;

// Seeded generator so a failure reproduces; no dependency is added for this.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261011);
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function randomAmount(): bigint {
  const digits = int(1, 15);
  let text = String(int(1, 9));
  for (let i = 1; i < digits; i += 1) text += String(int(0, 9));
  const value = BigInt(text);
  return value > MOVEMENT_AMOUNT_MAX_MINOR_UNITS ? MOVEMENT_AMOUNT_MAX_MINOR_UNITS : value;
}

/** A random composition of `total` into `parts` non-negative integers. */
function compose(total: bigint, parts: number): bigint[] {
  const cuts = Array.from({ length: parts - 1 }, () => BigInt(int(0, 1_000_000)));
  cuts.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const bounds = [0n, ...cuts.map((c) => (c * total) / 1_000_000n), total];
  return bounds.slice(1).map((b, i) => b - (bounds[i] ?? 0n));
}

function minorText(value: bigint): string {
  const s = value.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

function bpText(value: bigint): string {
  const s = value.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

function randomState(amount: bigint): { state: SplitState; payer: string } {
  const count = int(0, 1) === 0 ? int(1, 8) : int(1, 50);
  const members = Array.from({ length: count }, (_, i) => uuid(i + 1));
  const payer = members[int(0, count - 1)] ?? uuid(1);
  const selected = members.filter(() => rand() < 0.8);
  const base = createSplitState(amount, payer, selected.length === 0 ? members : selected);
  const mode = (['equal', 'percentage', 'exact'] as const)[int(0, 2)] ?? 'equal';
  const ids = base.selectedMemberIds;
  const values: Record<string, string> = {};
  const noisy = rand() < 0.3;
  if (mode === 'percentage') {
    compose(10_000n, ids.length).forEach((bp, i) => {
      values[ids[i] ?? ''] = bpText(noisy && i === 0 ? bp + BigInt(int(0, 3)) : bp);
    });
  } else if (mode === 'exact') {
    compose(amount, ids.length).forEach((v, i) => {
      values[ids[i] ?? ''] = minorText(noisy && i === 0 ? v + BigInt(int(0, 3)) : v);
    });
  }
  return { state: { ...base, mode, values }, payer };
}

describe('split editor property', () => {
  it(`never accepts a split the shared validators refuse (${CASES} cases)`, () => {
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < CASES; i += 1) {
      const amount = randomAmount();
      const { state, payer } = randomState(amount);
      const result = buildSplit(state, amount, payer, 'en-US');
      if (!result.ok) {
        rejected += 1;
        expect(result.errors.length).toBeGreaterThan(0);
        continue;
      }
      accepted += 1;
      expect(splitSchema.safeParse(result.split).success).toBe(true);
      const split = result.split;
      let shares: Map<string, bigint>;
      if (split.mode === 'equal') {
        shares = splitEqual(
          amount,
          [payer, ...split.memberIds.filter((m) => m !== payer)].filter((m) =>
            split.memberIds.includes(m),
          ),
        );
      } else if (split.mode === 'percentage') {
        shares = splitByBasisPoints(amount, split.shares);
      } else {
        shares = validateExactSplit(
          amount,
          split.shares.map((s) => ({ memberId: s.memberId, amount: BigInt(s.amount) })),
        );
      }
      let sum = 0n;
      for (const v of shares.values()) sum += v;
      expect(sum).toBe(amount);
    }
    expect(accepted).toBeGreaterThan(CASES / 2);
    expect(rejected).toBeGreaterThan(0);
  });
});
