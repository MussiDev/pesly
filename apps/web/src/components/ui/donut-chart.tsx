import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DonutSegment {
  key: string;
  label: string;
  /** Integer share in basis points; the legend prints it as given. */
  basisPoints: number;
}

interface DonutChartProps {
  /** The accessible name of the chart, e.g. "Composition by instrument type". */
  label: string;
  segments: readonly DonutSegment[];
  /** Locale-aware percentage text for a share in basis points. */
  formatPercent: (basisPoints: number) => string;
  /** Shown in the hole of the ring. */
  centre?: ReactNode;
  className?: string;
}

// Full class names so Tailwind finds them; segments beyond the fifth reuse the palette in order.
const ARC_CLASSES = [
  'stroke-chart-1',
  'stroke-chart-2',
  'stroke-chart-3',
  'stroke-chart-4',
  'stroke-chart-5',
] as const;
const DOT_CLASSES = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const;

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Visible gap between two arcs, in the same units as the circumference. */
const GAP = 2;

/** Only positive integers draw: zero, negative, fractional and non-finite weights are dropped. */
function isWeight(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * A donut drawn as stroked circles. The geometry is a drawing concern, not money: the shares come
 * in as integers and are only turned into arc lengths here. The legend repeats every share as text,
 * so the chart is never the only carrier of its meaning.
 */
export function DonutChart({ label, segments, formatPercent, centre, className }: DonutChartProps) {
  const positive = segments.filter((segment) => isWeight(segment.basisPoints));
  if (positive.length === 0) return null;

  const total = positive.reduce((sum, segment) => sum + segment.basisPoints, 0);
  let offset = 0;
  const arcs = positive.map((segment, index) => {
    const length = (CIRCUMFERENCE * segment.basisPoints) / total;
    const visible = positive.length > 1 ? Math.max(length - GAP, 0.5) : length;
    const arc = { segment, index, dash: `${visible} ${CIRCUMFERENCE - visible}`, offset: -offset };
    offset += length;
    return arc;
  });

  return (
    <figure data-slot="donut-chart" className={cn('flex items-center gap-5', className)}>
      <div className="relative size-28 shrink-0">
        <svg
          viewBox="0 0 140 140"
          role="img"
          aria-label={label}
          fill="none"
          className="size-full -rotate-90"
        >
          {arcs.map(({ segment, index, dash, offset: arcOffset }) => (
            <circle
              key={segment.key}
              data-segment={segment.key}
              cx={70}
              cy={70}
              r={RADIUS}
              strokeWidth={18}
              strokeDasharray={dash}
              strokeDashoffset={arcOffset}
              className={ARC_CLASSES[index % ARC_CLASSES.length]}
            />
          ))}
        </svg>
        {centre ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {centre}
          </div>
        ) : null}
      </div>
      <ul className="grid min-w-0 flex-1 gap-2.5">
        {arcs.map(({ segment, index }) => (
          <li key={segment.key} className="flex min-w-0 items-center gap-2 text-small">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-pill',
                DOT_CLASSES[index % DOT_CLASSES.length],
              )}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{segment.label}</span>
            <span className="font-semibold tabular-nums">{formatPercent(segment.basisPoints)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
