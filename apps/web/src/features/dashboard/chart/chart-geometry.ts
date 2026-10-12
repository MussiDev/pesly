import type { SeriesPointView } from '../dashboard-view';

/** A drawn point: `x` and `y` are integers from 0 to 1000 (y grows with the value). */
export interface ChartPoint {
  date: string;
  value: bigint;
  x: number;
  y: number;
}

export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 300;
const PAD_X = 24;
const PAD_Y = 24;

/**
 * The points that have a total, placed in the 0 to 1000 square. Money never meets a float: the
 * permille is a bigint division and only that whole number is converted.
 */
export function drawnPoints(points: readonly SeriesPointView[]): ChartPoint[] {
  const drawn = points.flatMap((point) =>
    point.total === null ? [] : [{ date: point.date, value: point.total }],
  );
  if (drawn.length === 0) return [];
  const values = drawn.map((point) => point.value);
  const min = values.reduce((low, value) => (value < low ? value : low));
  const max = values.reduce((high, value) => (value > high ? value : high));
  const span = max - min;
  const last = drawn.length - 1;
  return drawn.map((point, index) => {
    const permille = span === 0n ? 500n : ((point.value - min) * 1000n) / span;
    return {
      ...point,
      x: last === 0 ? 500 : Math.floor((index * 1000) / last),
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
