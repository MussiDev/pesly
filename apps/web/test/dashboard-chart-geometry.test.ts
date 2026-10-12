import { describe, expect, it } from 'vitest';
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  clampAnchor,
  clampIndex,
  drawnPoints,
  indexFromPosition,
  nearestIndexByX,
  toSvgX,
  toSvgY,
} from '../src/features/dashboard/chart/chart-geometry';
import type { SeriesPointView } from '../src/features/dashboard/dashboard-view';

function point(day: number, total: bigint | null): SeriesPointView {
  return {
    date: `2026-${String(day).padStart(2, '0')}-28`,
    ars: 0n,
    usd: 0n,
    total,
    reason: total === null ? 'no_rate' : null,
  };
}

describe('drawnPoints', () => {
  it('keeps the extremes at 0 and 1000 and spreads x over 0 to 1000', () => {
    const points = drawnPoints([point(1, 100n), point(2, 300n), point(3, 200n)]);
    expect(points.map((p) => p.y)).toEqual([0, 1000, 500]);
    expect(points.map((p) => p.x)).toEqual([0, 525, 1000]);
    expect(points.map((p) => p.value)).toEqual([100n, 300n, 200n]);
  });

  it('draws a flat series at 500 without dividing by zero', () => {
    const points = drawnPoints([point(1, 7n), point(2, 7n)]);
    expect(points.map((p) => p.y)).toEqual([500, 500]);
  });

  it('skips points with no total', () => {
    const points = drawnPoints([point(1, null), point(2, 5n), point(3, null)]);
    expect(points).toHaveLength(1);
    expect(points[0]?.date).toBe('2026-02-28');
  });

  it('places x by date and starts a new segment after a gap of null totals', () => {
    const points = drawnPoints([
      point(1, 1n),
      point(2, 2n),
      point(3, 3n),
      point(4, null),
      point(5, null),
      point(6, null),
      point(7, 7n),
      point(8, 8n),
      point(9, 9n),
    ]);
    expect(points.map((p) => p.segment)).toEqual([0, 0, 0, 1, 1, 1]);
    // July sits six months into an eight-month span, not at the fourth of six equal slots.
    expect(points[3]?.x).toBeGreaterThan(700);
    expect(points[3]?.x).toBeLessThan(800);
    expect(points[5]?.x).toBe(1000);
  });

  it('keeps one segment when every month has a total', () => {
    const points = drawnPoints([point(1, 1n), point(2, 2n), point(3, 3n)]);
    expect(new Set(points.map((p) => p.segment)).size).toBe(1);
  });

  it('never throws on 0 or 1 points', () => {
    expect(drawnPoints([])).toEqual([]);
    const [only] = drawnPoints([point(1, 0n)]);
    expect(only).toMatchObject({ x: 500, y: 500, value: 0n });
  });

  it('handles amounts beyond the safe integer range exactly', () => {
    const big = 9_000_000_000_000_000_000n;
    const points = drawnPoints([point(1, -big), point(2, big)]);
    expect(points.map((p) => p.y)).toEqual([0, 1000]);
  });

  it('handles negative values', () => {
    const points = drawnPoints([point(1, -100n), point(2, 100n), point(3, 0n)]);
    expect(points.map((p) => p.y)).toEqual([0, 1000, 500]);
  });
});

describe('selection helpers', () => {
  it('clamps an index into the range', () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(2, 0)).toBe(0);
  });

  it('maps a pointer position to the nearest point and ignores outside positions', () => {
    expect(indexFromPosition(0, 100, 3)).toBe(0);
    expect(indexFromPosition(50, 100, 3)).toBe(1);
    expect(indexFromPosition(100, 100, 3)).toBe(2);
    expect(indexFromPosition(-1, 100, 3)).toBeNull();
    expect(indexFromPosition(101, 100, 3)).toBeNull();
    expect(indexFromPosition(10, 0, 3)).toBeNull();
    expect(indexFromPosition(10, 100, 0)).toBeNull();
    expect(indexFromPosition(10, 100, 1)).toBe(0);
  });

  it('maps a pointer position to the drawn point nearest by x', () => {
    const xs = [0, 100, 1000];
    expect(nearestIndexByX(4, 100, xs)).toBe(0);
    expect(nearestIndexByX(40, 100, xs)).toBe(1);
    expect(nearestIndexByX(100, 100, xs)).toBe(2);
    expect(nearestIndexByX(-1, 100, xs)).toBeNull();
    expect(nearestIndexByX(101, 100, xs)).toBeNull();
    expect(nearestIndexByX(10, 0, xs)).toBeNull();
    expect(nearestIndexByX(10, 100, [])).toBeNull();
  });

  it('clamps the tooltip anchor so it stays inside the plot', () => {
    expect(clampAnchor(0)).toBe(100);
    expect(clampAnchor(1000)).toBe(900);
    expect(clampAnchor(500)).toBe(500);
  });

  it('maps coordinates into the view box as integers', () => {
    expect(toSvgX(0)).toBeGreaterThan(0);
    expect(toSvgX(1000)).toBeLessThan(VIEW_WIDTH);
    expect(toSvgY(1000)).toBeLessThan(toSvgY(0));
    expect(toSvgY(0)).toBeLessThan(VIEW_HEIGHT);
    expect(Number.isInteger(toSvgX(333))).toBe(true);
    expect(Number.isInteger(toSvgY(333))).toBe(true);
  });
});
