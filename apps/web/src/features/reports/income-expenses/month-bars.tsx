import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';
import type { Locale } from '@/i18n/routing';
import type { MonthView, ReportCurrency } from '../report-view';
import { signedMoney } from './signed-money';

/** Most months the drawing and the list carry (the answer is bounded by the 12-month limit). */
export const MAX_DRAWN_MONTHS = 24;

const WIDTH = 360;
const PLOT_TOP = 26;
const PLOT_HEIGHT = 120;
const BASELINE = PLOT_TOP + PLOT_HEIGHT;
const MONTH_Y = BASELINE + 14;
const SIGN_Y = BASELINE + 28;
const NET_Y = BASELINE + 42;
const HEIGHT = BASELINE + 50;
/** Rough width of one character at the label size; labels are spaced from it, not measured. */
const CHAR_WIDTH = 5.6;

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

/**
 * Grouped bars in plain SVG: one income bar and one expense bar per month. Income is a solid fill and
 * expenses a striped one, each named in the legend, so colour is never the only difference; under
 * each month a sign, and on the labelled months the signed net result. The drawing is decorative:
 * the figures list beside it carries every number.
 */
export function MonthBars({ months, currency, locale }: MonthBarsProps) {
  const t = useTranslations('reports.incomeExpenses');
  const format = useFormatter();
  const patternId = `stripes-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const drawn = months.slice(0, MAX_DRAWN_MONTHS);

  const nets = drawn.map((month) => signedMoney(month.net, currency, locale));
  const widest = nets.reduce((max, text) => Math.max(max, text.length), 0);
  const labelWidth = widest * CHAR_WIDTH + 8;
  const pad = Math.ceil(labelWidth / 2);
  const plotWidth = WIDTH - 2 * pad;
  const slot = plotWidth / Math.max(drawn.length, 1);
  const step = labelStep(drawn.length, labelWidth, plotWidth);

  const largest = drawn.reduce(
    (max, month) => [month.income, month.expenses].reduce((a, b) => (b > a ? b : a), max),
    0n,
  );
  const barWidth = Math.max(1, Math.floor((slot * 0.8) / 2));

  return (
    <svg
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      className="h-auto w-full max-w-full"
      focusable="false"
    >
      <defs>
        <pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={4}
          height={4}
          patternTransform="rotate(45)"
        >
          <rect width={4} height={4} className="fill-expense" />
          <rect width={2} height={4} className="fill-background" />
        </pattern>
      </defs>
      <rect x={pad} y={2} width={10} height={10} className="fill-income" />
      <text x={pad + 14} y={11} fontSize={10} className="fill-muted-foreground">
        {t('income')}
      </text>
      <rect x={pad + 90} y={2} width={10} height={10} fill={`url(#${patternId})`} />
      <text x={pad + 104} y={11} fontSize={10} className="fill-muted-foreground">
        {t('expenses')}
      </text>
      <line x1={pad} x2={WIDTH - pad} y1={BASELINE} y2={BASELINE} className="stroke-border" />
      {drawn.map((month, index) => {
        const start = pad + index * slot;
        const centre = start + slot / 2;
        const incomeHeight = barHeight(month.income, largest);
        const expenseHeight = barHeight(month.expenses, largest);
        const labelled = index % step === 0;
        const net = nets[index] ?? '';
        const netClass =
          month.net > 0n
            ? 'fill-income'
            : month.net < 0n
              ? 'fill-expense'
              : 'fill-muted-foreground';
        const monthName = format.dateTime(new Date(`${month.month}-01T00:00:00Z`), {
          month: 'short',
          timeZone: 'UTC',
        });
        return (
          <g key={`${month.month}-${String(index)}`}>
            <rect
              data-bar="income"
              x={Math.round(centre - barWidth)}
              y={BASELINE - incomeHeight}
              width={barWidth}
              height={incomeHeight}
              className="fill-income"
            />
            <rect
              data-bar="expenses"
              x={Math.round(centre)}
              y={BASELINE - expenseHeight}
              width={barWidth}
              height={expenseHeight}
              fill={`url(#${patternId})`}
            />
            <text
              x={centre}
              y={SIGN_Y}
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
              className={netClass}
              data-net-sign=""
            >
              {month.net > 0n ? '+' : month.net < 0n ? '−' : '0'}
            </text>
            {labelled ? (
              <>
                <text
                  x={centre}
                  y={MONTH_Y}
                  fontSize={10}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  data-month-label=""
                >
                  {monthName}
                </text>
                <text
                  x={centre}
                  y={NET_Y}
                  fontSize={10}
                  textAnchor="middle"
                  className={netClass}
                  data-net-label=""
                >
                  {net}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
