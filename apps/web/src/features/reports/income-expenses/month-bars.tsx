import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';
import type { Locale } from '@/i18n/routing';
import type { MonthView, ReportCurrency } from '../report-view';

/** Most months the drawing and the list carry (the answer is bounded by the 12-month limit). */
export const MAX_DRAWN_MONTHS = 24;

const WIDTH = 360;
/**
 * Axis text in viewBox units: the chart is drawn about 10 % smaller on a 390 px phone, so 13 units
 * render near the 12 px caption size instead of below the 11 px floor.
 */
const LABEL_SIZE = 13;
const AXIS = 44;
const PLOT_TOP = 8;
const PLOT_HEIGHT = 140;
const BASELINE = PLOT_TOP + PLOT_HEIGHT;
const MONTH_Y = BASELINE + 16;
const HEIGHT = BASELINE + 22;
/** Rough width of one month label at its size; labels are spaced from it, not measured. */
const MONTH_LABEL_WIDTH = 34;

export interface MonthBarsProps {
  months: readonly MonthView[];
  currency: ReportCurrency;
  locale: Locale;
}

/** Bar height in whole drawing units: a bigint division into permille, then a small integer. */
export function barHeight(value: bigint, largest: bigint): number {
  if (value <= 0n || largest <= 0n) return 0;
  const permille = Number((value * 1000n) / largest);
  return Math.max(1, Math.round((permille * PLOT_HEIGHT) / 1000));
}

/** Every how many months a label is drawn so two labels never share the same horizontal space. */
export function labelStep(count: number, labelWidth: number, plotWidth: number): number {
  if (count <= 0) return 1;
  return Math.max(1, Math.ceil(labelWidth / (plotWidth / count)));
}

/** The top of the scale: the smallest 1, 2 or 5 times a power of ten (minor units) at or above `value`. */
export function scaleTop(value: bigint): bigint {
  if (value <= 0n) return 100n;
  let power = 1n;
  while (power * 10n <= value) power *= 10n;
  for (const step of [1n, 2n, 5n, 10n]) {
    if (power * step >= value) return power * step;
  }
  return power * 10n;
}

/**
 * Grouped bars in plain SVG, as NorteAR's monthly chart: income solid on the left of each month
 * and expenses striped on the right, a scale of three compact values and the month names below. The drawing is
 * decorative: the legend names the colours and the list under it carries every number.
 */
/** Expenses are striped as well as red, so the two bars never differ by colour alone. */
function Stripes({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={id}
        patternUnits="userSpaceOnUse"
        width={4}
        height={4}
        patternTransform="rotate(45)"
      >
        <rect width={4} height={4} className="fill-expense" />
        <rect width={1.5} height={4} className="fill-card" />
      </pattern>
    </defs>
  );
}

export function MonthBars({ months, currency, locale }: MonthBarsProps) {
  const format = useFormatter();
  const patternId = `stripes-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const drawn = months.slice(0, MAX_DRAWN_MONTHS);
  const largest = drawn.reduce(
    (max, month) => [month.income, month.expenses].reduce((a, b) => (b > a ? b : a), max),
    0n,
  );
  const top = scaleTop(largest);
  const plotWidth = WIDTH - AXIS;
  const slot = plotWidth / Math.max(drawn.length, 1);
  const step = labelStep(drawn.length, MONTH_LABEL_WIDTH, plotWidth);
  const barWidth = Math.max(2, Math.min(18, Math.floor((slot * 0.7) / 2)));
  const compact = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-AR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const ticks = [top, top / 2n, 0n];

  return (
    <svg
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      className="h-auto w-full max-w-full"
      focusable="false"
      data-currency={currency}
    >
      <Stripes id={patternId} />
      {ticks.map((tick) => {
        const y = BASELINE - barHeight(tick, top);
        return (
          <g key={tick.toString()}>
            <line
              x1={AXIS}
              x2={WIDTH}
              y1={y}
              y2={y}
              strokeDasharray={tick === 0n ? undefined : '3 3'}
              className="stroke-border"
            />
            <text
              x={AXIS - 6}
              y={y + 4}
              fontSize={LABEL_SIZE}
              textAnchor="end"
              className="fill-muted-foreground"
              data-tick=""
            >
              {/* Whole units of the currency: the scale is a rough guide, the list has the cents. */}
              {compact.format(tick / 100n)}
            </text>
          </g>
        );
      })}
      {drawn.map((month, index) => {
        const centre = AXIS + index * slot + slot / 2;
        const incomeHeight = barHeight(month.income, top);
        const expenseHeight = barHeight(month.expenses, top);
        return (
          <g key={`${month.month}-${String(index)}`}>
            <rect
              data-bar="income"
              x={Math.round(centre - barWidth - 1)}
              y={BASELINE - incomeHeight}
              width={barWidth}
              height={incomeHeight}
              rx={2}
              className="fill-income"
            />
            <rect
              data-bar="expenses"
              x={Math.round(centre + 1)}
              y={BASELINE - expenseHeight}
              width={barWidth}
              height={expenseHeight}
              rx={2}
              fill={`url(#${patternId})`}
            />
            {index % step === 0 ? (
              <text
                x={centre}
                y={MONTH_Y}
                fontSize={LABEL_SIZE}
                textAnchor="middle"
                className="fill-muted-foreground"
                data-month-label=""
              >
                {format.dateTime(new Date(`${month.month}-01T00:00:00Z`), {
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** The legend of the bars, as text so it reads at any size. */
export function MonthBarsLegend() {
  const t = useTranslations('reports.incomeExpenses');
  const patternId = `legend-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-xs bg-income" />
        {t('income')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg aria-hidden="true" viewBox="0 0 10 10" className="size-2.5 rounded-xs">
          <Stripes id={patternId} />
          <rect width={10} height={10} fill={`url(#${patternId})`} />
        </svg>
        {t('expenses')}
      </span>
    </p>
  );
}
