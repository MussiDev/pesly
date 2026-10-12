import type { RingSegmentView } from './report-view';

export interface ShareView {
  /** Whole percent, 0 to 100. */
  percent: number;
  /** A positive row whose share is below 1%. */
  underOne: boolean;
}

const RING_LARGEST = 5;

/**
 * Whole-percent share of each row, by integer division rounded down. The leftover up to 100 goes to
 * the largest row, so the shown shares never exceed 100. A total of 0 or less gives no shares.
 */
export function computeShares(rows: readonly { amount: bigint }[], total: bigint): ShareView[] {
  if (total <= 0n) return [];

  const positiveSum = rows.reduce((sum, row) => (row.amount > 0n ? sum + row.amount : sum), 0n);
  // Rows that add up to more than the total must still fit in 100%.
  const base = positiveSum > total ? positiveSum : total;

  const percents = rows.map((row) =>
    row.amount > 0n ? Number.parseInt(String((row.amount * 100n) / base), 10) : 0,
  );

  if (positiveSum >= total) {
    const leftover = 100 - percents.reduce((sum, percent) => sum + percent, 0);
    let largest = -1;
    rows.forEach((row, index) => {
      const best = largest === -1 ? undefined : rows[largest];
      if (row.amount > 0n && (best === undefined || row.amount > best.amount)) largest = index;
    });
    const current = largest === -1 ? undefined : percents[largest];
    // With nothing at 1% or more there is no row the leftover could honestly be added to.
    if (current !== undefined && current > 0) percents[largest] = current + leftover;
  }

  return rows.map((row, index) => {
    const percent = percents[index] ?? 0;
    return { percent, underOne: row.amount > 0n && percent === 0 };
  });
}

/**
 * The ring: the five largest positive rows plus one "rest" segment when more remain. A row of 0 or
 * less is not drawn. `restLabel` is the catalog text of the rest segment.
 */
export function ringSegments(
  rows: readonly { key: string; label: string; amount: bigint }[],
  restLabel = '',
): RingSegmentView[] {
  const positive = rows
    .filter((row) => row.amount > 0n)
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
  const segments: RingSegmentView[] = positive
    .slice(0, RING_LARGEST)
    .map((row) => ({ key: row.key, label: row.label, amount: row.amount, isRest: false }));
  const rest = positive.slice(RING_LARGEST);
  if (rest.length > 0) {
    segments.push({
      key: 'rest',
      label: restLabel,
      amount: rest.reduce((sum, row) => sum + row.amount, 0n),
      isRest: true,
    });
  }
  return segments;
}
