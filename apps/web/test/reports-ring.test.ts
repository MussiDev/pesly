import { describe, expect, it } from 'vitest';
import { ringSegments } from '../src/features/reports/shares';

const row = (n: number, amount: bigint) => ({ key: `k${n}`, label: `Cat ${n}`, amount });

describe('ringSegments (FR-05)', () => {
  it('8 rows give the 5 largest plus one rest segment, 6 in all (AC-11)', () => {
    const rows = [8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n].map((amount, i) => row(i, amount * 100n));
    const segments = ringSegments(rows, 'Other');
    expect(segments).toHaveLength(6);
    expect(segments.slice(0, 5).map((s) => s.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    expect(segments[5]).toEqual({ key: 'rest', label: 'Other', amount: 600n, isRest: true });
    expect(rows).toHaveLength(8);
  });

  it('exactly 6 positive rows still draw 6 segments with a rest of one row', () => {
    const rows = [6n, 5n, 4n, 3n, 2n, 1n].map((amount, i) => row(i, amount));
    const segments = ringSegments(rows);
    expect(segments).toHaveLength(6);
    expect(segments[5]?.isRest).toBe(true);
    expect(segments[5]?.amount).toBe(1n);
  });

  it('5 or fewer rows have no rest segment and are ordered from the largest', () => {
    const segments = ringSegments([row(1, 10n), row(2, 30n), row(3, 20n)]);
    expect(segments.map((s) => s.amount)).toEqual([30n, 20n, 10n]);
    expect(segments.some((s) => s.isRest)).toBe(false);
  });

  it('error: rows that are all zero or negative give zero segments', () => {
    expect(ringSegments([row(1, 0n), row(2, -5n)])).toEqual([]);
    expect(ringSegments([])).toEqual([]);
  });

  it('does not draw a non-positive row among positive ones', () => {
    const segments = ringSegments([row(1, 10n), row(2, -5n), row(3, 0n)]);
    expect(segments.map((s) => s.key)).toEqual(['k1']);
  });
});
