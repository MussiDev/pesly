import type { RingSegmentView } from './report-view';

export interface ShareView {
  /** Whole percent, 0 to 100. */
  percent: number;
  /** A positive row whose share is below 1%. */
  underOne: boolean;
}

const RING_LARGEST = 5;

/**
 * Whole-percent share of each row by the largest-remainder method, with integers only: every row
 * is rounded down and, when the rows cover the total, the leftover points go one by one to the rows
 * with the largest fractional remainders (ties: the larger amount, then the earlier row). No row
 * ends above its true share plus one point. A row under 1% stays at 0 (`underOne`) and never takes
 * a leftover point, so the shown shares may then add up to less than 100. A total of 0 or less
 * gives no shares.
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
    let leftover = 100 - percents.reduce((sum, percent) => sum + percent, 0);
    const candidates = rows
      .map((row, index) => ({
        index,
        amount: row.amount,
        remainder: row.amount > 0n ? (row.amount * 100n) % base : 0n,
      }))
      // A row under 1% keeps its "<1%" and a whole share has nothing left to round up.
      .filter((entry) => entry.remainder > 0n && (percents[entry.index] ?? 0) > 0)
      .sort((a, b) => {
        if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
        if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
        return a.index - b.index;
      });
    for (const entry of candidates) {
      if (leftover <= 0) break;
      percents[entry.index] = (percents[entry.index] ?? 0) + 1;
      leftover -= 1;
    }
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
