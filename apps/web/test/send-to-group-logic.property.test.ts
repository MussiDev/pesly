import { MOVEMENT_AMOUNT_MAX_MINOR_UNITS } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { previewShares } from '../src/features/groups/split/split-request';
import {
  AUTOMATIC_CATEGORY,
  defaultSendSplit,
} from '../src/features/movements/send-to-group/send-defaults';
import { buildSendRequest } from '../src/features/movements/send-to-group/send-request';

const CASES = 1_000;
const SELF = '11111111-1111-4111-8111-111111111111';
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

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
const rand = mulberry32(20261012);
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));

function randomAmount(): bigint {
  let text = String(int(1, 9));
  for (let i = 1, n = int(1, 15); i < n; i += 1) text += String(int(0, 9));
  const value = BigInt(text);
  return value > MOVEMENT_AMOUNT_MAX_MINOR_UNITS ? MOVEMENT_AMOUNT_MAX_MINOR_UNITS : value;
}

describe('send split property', () => {
  it('the built equal split adds up to the movement amount', () => {
    const members = IDS.map((id) => ({ id }));
    for (let i = 0; i < CASES; i += 1) {
      const amount = randomAmount();
      const split = defaultSendSplit({ selfMemberId: SELF, members });
      const result = buildSendRequest(
        { description: 'x', category: AUTOMATIC_CATEGORY, split },
        { movementId: SELF, amount, memberIds: IDS, categories: [], locale: 'en' },
      );
      expect(result.request).toBeDefined();
      const shares = previewShares({ ...split, amount }, amount, SELF, 'en');
      const total = (shares ?? []).reduce((sum, share) => sum + share.amount, 0n);
      expect(total).toBe(amount);
    }
  });
});
