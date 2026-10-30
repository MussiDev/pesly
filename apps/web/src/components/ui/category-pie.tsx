import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { CATEGORY_COLORS, type CategoryColor } from '@pesly/shared';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface CategoryPieSegment {
  key: string;
  label: string;
  /** Already formatted with its currency; one line per currency when there are several. */
  amounts: readonly string[];
  /** Share of the ring in basis points (0 to 10000); zero shows in the legend but draws no arc. */
  basisPoints: number;
  /** The category's colour key; an unknown or missing one takes a neutral colour. */
  color?: string | undefined;
  /** Small text under the label, e.g. "3 movements". */
  detail?: string | undefined;
  /** Where the legend row links to; the arc then reports the tap through `onSelect`. */
  href?: string | undefined;
  /** The accessible name of the tap, e.g. "Show only Food". */
  actionLabel?: string | undefined;
  /** `false` for a row that only informs, e.g. movements without a category. */
  selectable?: boolean | undefined;
}

interface CategoryPieProps {
  /** The accessible name of the ring, e.g. "Spending by category". */
  label: string;
  segments: readonly CategoryPieSegment[];
  /** Locale-aware percentage text of a share in basis points. */
  formatPercent: (basisPoints: number) => string;
  /** Shown in the hole of the ring, e.g. the total. */
  centre?: ReactNode;
  /** The segment in use: drawn in full while the others fade. */
  selectedKey?: string | undefined;
  onSelect?: ((key: string) => void) | undefined;
  /** How many legend rows show; the rest are left to the caller's "show all". */
  visibleRows?: number;
  className?: string;
}

// Literal class names so Tailwind finds them; the tokens are defined in globals.css.
const STROKE: Record<CategoryColor, string> = {
  red: 'stroke-category-red',
  orange: 'stroke-category-orange',
  amber: 'stroke-category-amber',
  yellow: 'stroke-category-yellow',
  lime: 'stroke-category-lime',
  green: 'stroke-category-green',
  teal: 'stroke-category-teal',
  cyan: 'stroke-category-cyan',
  blue: 'stroke-category-blue',
  violet: 'stroke-category-violet',
  pink: 'stroke-category-pink',
  slate: 'stroke-category-slate',
};
const DOT: Record<CategoryColor, string> = {
  red: 'bg-category-red',
  orange: 'bg-category-orange',
  amber: 'bg-category-amber',
  yellow: 'bg-category-yellow',
  lime: 'bg-category-lime',
  green: 'bg-category-green',
  teal: 'bg-category-teal',
  cyan: 'bg-category-cyan',
  blue: 'bg-category-blue',
  violet: 'bg-category-violet',
  pink: 'bg-category-pink',
  slate: 'bg-category-slate',
};
/** Rows without a colour of their own take these in turn, so neighbours stay apart. */
const FALLBACK: readonly CategoryColor[] = [
  'violet',
  'cyan',
  'amber',
  'pink',
  'teal',
  'lime',
  'blue',
  'red',
];

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Visible gap between two arcs, in the same units as the circumference. */
const GAP = 1.5;

function colorOf(segment: CategoryPieSegment, index: number): CategoryColor {
  const known = CATEGORY_COLORS.find((color) => color === segment.color);
  return known ?? FALLBACK[index % FALLBACK.length] ?? 'slate';
}

/**
 * A ring of categories whose arcs and legend rows can be tapped to open that category. The arcs
 * answer a pointer; the legend rows are the real buttons or links, so the keyboard and screen
 * readers reach every category with its amount and share as text.
 */
export function CategoryPie({
  label,
  segments,
  formatPercent,
  centre,
  selectedKey,
  onSelect,
  visibleRows,
  className,
}: CategoryPieProps) {
  const drawn = segments
    .map((segment, index) => ({ segment, color: colorOf(segment, index) }))
    .filter(({ segment }) => Number.isInteger(segment.basisPoints) && segment.basisPoints > 0);
  // Drawing geometry only: the shares are small integers, so the conversion is exact.
  const total = drawn.reduce((sum, { segment }) => sum + segment.basisPoints, 0);
  let offset = 0;
  const arcs = drawn.map(({ segment, color }) => {
    const length = total === 0 ? 0 : (CIRCUMFERENCE * segment.basisPoints) / total;
    const visible = drawn.length > 1 ? Math.max(length - GAP, 0.5) : length;
    const arc = { segment, color, dash: `${visible} ${CIRCUMFERENCE - visible}`, offset: -offset };
    offset += length;
    return arc;
  });
  const shown = visibleRows === undefined ? segments : segments.slice(0, visibleRows);
  // A selection that is not one of the segments (e.g. the parent of the subcategories shown) fades nothing.
  const activeKey = segments.some((segment) => segment.key === selectedKey)
    ? selectedKey
    : undefined;

  return (
    <figure data-slot="category-pie" className={cn('grid gap-4', className)}>
      {arcs.length === 0 ? null : (
        <div className="relative mx-auto size-48">
          <svg
            viewBox="0 0 140 140"
            role="img"
            aria-label={label}
            fill="none"
            className="size-full -rotate-90"
          >
            <circle cx={70} cy={70} r={RADIUS} strokeWidth={20} className="stroke-muted" />
            {arcs.map(({ segment, color, dash, offset: arcOffset }) => {
              const faded = activeKey !== undefined && activeKey !== segment.key;
              const selectable =
                onSelect !== undefined && segment.selectable !== false && activeKey !== segment.key;
              return (
                <circle
                  key={segment.key}
                  data-segment={segment.key}
                  cx={70}
                  cy={70}
                  r={RADIUS}
                  strokeWidth={activeKey === segment.key ? 26 : 20}
                  strokeDasharray={dash}
                  strokeDashoffset={arcOffset}
                  className={cn(
                    STROKE[color],
                    'transition-[opacity,stroke-width] motion-reduce:transition-none',
                    faded && 'opacity-30',
                    selectable && 'cursor-pointer',
                  )}
                  onClick={
                    selectable
                      ? () => {
                          onSelect(segment.key);
                        }
                      : undefined
                  }
                />
              );
            })}
          </svg>
          {centre === undefined ? null : (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
              {centre}
            </div>
          )}
        </div>
      )}
      <ul role="list" aria-label={label} className="-mx-2 grid">
        {shown.map((segment) => {
          const index = segments.indexOf(segment);
          const color = colorOf(segment, index);
          const selected = activeKey === segment.key;
          const body = (
            <>
              <span aria-hidden="true" className={cn('size-3 shrink-0 rounded-pill', DOT[color])} />
              <span className="grid min-w-0 flex-1 gap-0.5 text-left">
                <span className="text-small font-semibold break-words">{segment.label}</span>
                {segment.detail === undefined ? null : (
                  <span className="text-caption text-muted-foreground">{segment.detail}</span>
                )}
              </span>
              <span className="grid shrink-0 justify-items-end gap-0.5">
                {segment.amounts.map((amount) => (
                  <span key={amount} className="text-small font-semibold tabular-nums">
                    {amount}
                  </span>
                ))}
                <span className="text-caption text-muted-foreground tabular-nums">
                  {formatPercent(segment.basisPoints)}
                </span>
              </span>
            </>
          );
          const rowClass = cn(
            'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2',
            selected && 'bg-accent',
          );
          const actionClass =
            'cursor-pointer transition-colors outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';
          return (
            <li key={segment.key}>
              {segment.href !== undefined ? (
                <Link
                  href={segment.href}
                  aria-label={segment.actionLabel}
                  className={cn(rowClass, actionClass)}
                >
                  {body}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              ) : onSelect !== undefined && !selected && segment.selectable !== false ? (
                <button
                  type="button"
                  aria-label={segment.actionLabel}
                  className={cn(rowClass, actionClass)}
                  onClick={() => {
                    onSelect(segment.key);
                  }}
                >
                  {body}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ) : (
                <div className={rowClass} aria-current={selected ? 'true' : undefined}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
