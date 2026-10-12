import type { SeriesPointView } from '../dashboard-view';

/**
 * A drawn point: `x` and `y` are integers from 0 to 1000 (y grows with the value). `segment`
 * counts the breaks: points of one segment are consecutive months, so a line joins only those.
 */
export interface ChartPoint {
  date: string;
  value: bigint;
  x: number;
  y: number;
  segment: number;
}

export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 300;
const PAD_X = 24;
const PAD_Y = 24;

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / DAY_MS);
}

/**
 * The points that have a total, placed in the 0 to 1000 square. x follows the date, so a month
 * without a total leaves a visible gap and starts a new segment instead of being bridged. Money
 * never meets a float: the permille is a bigint division and only that whole number is converted.
 */
export function drawnPoints(points: readonly SeriesPointView[]): ChartPoint[] {
  const drawn = points.flatMap((point, position) =>
    point.total === null ? [] : [{ date: point.date, value: point.total, position }],
  );
  const firstDrawn = drawn[0];
  const lastDrawn = drawn[drawn.length - 1];
  if (firstDrawn === undefined || lastDrawn === undefined) return [];
  const values = drawn.map((point) => point.value);
  const min = values.reduce((low, value) => (value < low ? value : low));
  const max = values.reduce((high, value) => (value > high ? value : high));
  const span = max - min;
  const startDay = dayNumber(firstDrawn.date);
  const days = dayNumber(lastDrawn.date) - startDay;
  let segment = 0;
  return drawn.map((point, index) => {
    const previous = drawn[index - 1];
    if (previous !== undefined && point.position - previous.position > 1) segment += 1;
    const permille = span === 0n ? 500n : ((point.value - min) * 1000n) / span;
    return {
      date: point.date,
      value: point.value,
      segment,
      x: days <= 0 ? 500 : Math.floor(((dayNumber(point.date) - startDay) * 1000) / days),
      y: Number.parseInt(permille.toString(), 10),
    };
  });
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index));
}

/** The nearest point for a pointer offset inside the plot; null when the pointer is outside. */
export function indexFromPosition(offset: number, width: number, count: number): number | null {
  if (width <= 0 || count <= 0 || offset < 0 || offset > width) return null;
  if (count === 1) return 0;
  return clampIndex(Math.round((offset * (count - 1)) / width), count);
}

/** The drawn point nearest by x to a pointer offset inside the plot; null when it is outside. */
export function nearestIndexByX(
  offset: number,
  width: number,
  xs: readonly number[],
): number | null {
  if (width <= 0 || xs.length === 0 || offset < 0 || offset > width) return null;
  const target = (offset * 1000) / width;
  let best = 0;
  xs.forEach((x, index) => {
    if (Math.abs(x - target) < Math.abs((xs[best] ?? 0) - target)) best = index;
  });
  return best;
}

/** Keeps the tooltip's center away from the plot edges so it never leaves the plot. */
export function clampAnchor(x: number): number {
  return Math.min(900, Math.max(100, x));
}

export function toSvgX(x: number): number {
  return PAD_X + Math.round((x * (VIEW_WIDTH - 2 * PAD_X)) / 1000);
}

/** The value axis points up, the SVG axis points down. */
export function toSvgY(y: number): number {
  return PAD_Y + Math.round(((1000 - y) * (VIEW_HEIGHT - 2 * PAD_Y)) / 1000);
}
