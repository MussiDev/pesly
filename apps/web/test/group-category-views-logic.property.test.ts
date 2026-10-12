import type { GroupCategoryResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { buildSummaryView } from '../src/features/groups/category-views/summary-view';

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

const rand = mulberry32(20261012);
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));

function randomTotal(): bigint {
  const digits = int(1, 15);
  let text = String(int(1, 9));
  for (let i = 1; i < digits; i += 1) text += String(int(0, 9));
  return BigInt(text);
}

describe('summary shares (property)', () => {
  it('every share is within 1 basis point of the exact ratio', () => {
    for (let n = 0; n < CASES; n += 1) {
      const lineCount = int(1, 8);
      const categories: GroupCategoryResponse[] = [];
      const lines = [];
      let total = 0n;
      for (let i = 0; i < lineCount; i += 1) {
        const id = `c${i}`;
        const amount = randomTotal();
        total += amount;
        categories.push({
          id,
          defaultKey: null,
          name: `Name ${i}`,
          icon: 'utensils',
          color: 'red',
          archivedAt: null,
        });
        lines.push({ categoryId: id, total: amount.toString(), count: 1 });
      }
      const view = buildSummaryView(
        {
          from: '2026-10-01T03:00:00.000Z',
          to: '2026-11-01T02:59:59.999Z',
          currencies: [
            { currency: 'ARS', total: total.toString(), count: lineCount, categories: lines },
          ],
          categories,
        },
        'en',
      );
      const currency = view.currencies[0];
      expect(currency?.total).toBe(total);
      for (const line of currency?.lines ?? []) {
        const share = BigInt(line.shareBasisPoints);
        // |share - exact| <= 1  <=>  |share * total - line.total * 10000| <= total
        const diff = share * total - line.total * 10000n;
        expect((diff < 0n ? -diff : diff) <= total).toBe(true);
        expect(line.shareBasisPoints).toBeGreaterThanOrEqual(0);
        expect(line.shareBasisPoints).toBeLessThanOrEqual(10000);
      }
      if (lineCount === 1) expect(currency?.lines[0]?.shareBasisPoints).toBe(10000);
    }
  });
});
