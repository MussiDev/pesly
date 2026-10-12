'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  clampAnchor,
  clampIndex,
  drawnPoints,
  nearestIndexByX,
  toSvgX,
  toSvgY,
} from '@/features/dashboard/chart/chart-geometry';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { ChartFigure } from '../components/figures-list';
import type { NetWorthPointView, ReportCurrency } from '../report-view';

const PAGE = 3;

export interface NetWorthAreaChartProps {
  locale: Locale;
  currency: ReportCurrency;
  /** At most the 24 points to draw; a month without a total leaves a gap. */
  points: readonly NetWorthPointView[];
  /** `YYYY-MM-DD` of the selected point, or null when nothing is selected. */
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
  from: string;
  to: string;
}

/**
 * The net worth as an SVG area and line. The drawing is hidden from assistive technology; the
 * transparent slider laid over it is the one focusable control (pointer, tap and arrow keys).
 */
export function NetWorthAreaChart({
  locale,
  currency,
  points,
  selectedDate,
  onSelect,
  from,
  to,
}: NetWorthAreaChartProps) {
  const t = useTranslations('reports.netWorth');
  const drawn = drawnPoints(points);
  const [announcement, setAnnouncement] = useState('');
  const focused = useRef(false);
  const count = drawn.length;
  const found = drawn.findIndex((point) => point.date === selectedDate);
  const current = clampIndex(found === -1 ? count - 1 : found, count);
  const currentPoint = drawn[current];

  const describe = (index: number, key: 'tooltip' | 'announce') => {
    const point = drawn[clampIndex(index, count)];
    return point === undefined
      ? ''
      : t(key, {
          date: formatCalendarDate(point.date, locale),
          value: formatMoney(point.value, currency, locale),
        });
  };

  const coordinates = drawn.map((point) => ({
    x: toSvgX(point.x),
    y: toSvgY(point.y),
    segment: point.segment,
  }));
  const segments = coordinates.reduce<(typeof coordinates)[]>((groups, coordinate) => {
    const group = groups[coordinate.segment];
    if (group === undefined) groups.push([coordinate]);
    else group.push(coordinate);
    return groups;
  }, []);
  // A run of one month has nothing to join: it is only its dot.
  const joined = segments
    .filter((group) => group.length > 1)
    .map((group) => {
      const line = group.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
      const start = group[0];
      const end = group[group.length - 1];
      return {
        key: start?.x ?? 0,
        line,
        area: `${line} L${end?.x ?? 0} ${VIEW_HEIGHT} L${start?.x ?? 0} ${VIEW_HEIGHT} Z`,
      };
    });

  const choose = (index: number, announce: boolean) => {
    const next = clampIndex(index, count);
    const point = drawn[next];
    if (point === undefined) return;
    onSelect(point.date);
    if (announce) setAnnouncement(describe(next, 'announce'));
  };

  const selectAt = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const index = nearestIndexByX(
      clientX - rect.left,
      rect.width,
      drawn.map((point) => point.x),
    );
    if (index !== null) choose(index, false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowDown: current - 1,
      ArrowRight: current + 1,
      ArrowUp: current + 1,
      Home: 0,
      End: count - 1,
      PageUp: current + PAGE,
      PageDown: current - PAGE,
    };
    if (event.key === 'Escape') {
      onSelect(null);
      setAnnouncement('');
      return;
    }
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next, true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative min-w-0">
        <ChartFigure
          name={t('chartName')}
          summary={t('chartSummary', {
            from: formatCalendarDate(from, locale),
            to: formatCalendarDate(to, locale),
            points: points.length,
          })}
        >
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="block h-auto w-full"
            focusable="false"
          >
            {joined.map(({ key, line, area }) => (
              <g key={key}>
                <path data-chart-area d={area} className="fill-chart-2/15 stroke-none" />
                <path
                  data-chart-line
                  d={line}
                  fill="none"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  className="stroke-chart-2"
                />
              </g>
            ))}
            {coordinates.map(({ x, y }, index) => (
              <circle
                key={drawn[index]?.date ?? index}
                cx={x}
                cy={y}
                r={index === current && selectedDate !== null ? 9 : 6}
                className="fill-chart-2"
              />
            ))}
          </svg>
        </ChartFigure>
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('chartName')}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={current}
          aria-valuetext={describe(current, 'announce')}
          className="absolute inset-0 min-h-11 touch-pan-y rounded-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onFocus={() => {
            focused.current = true;
            if (selectedDate === null) choose(count - 1, true);
          }}
          onBlur={() => {
            focused.current = false;
            onSelect(null);
            setAnnouncement('');
          }}
          onKeyDown={onKeyDown}
          onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
            selectAt(event.clientX, event.currentTarget);
          }}
          onPointerLeave={() => {
            if (!focused.current) onSelect(null);
          }}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            selectAt(event.clientX, event.currentTarget);
          }}
        />
        {selectedDate !== null && currentPoint !== undefined ? (
          <div
            data-testid="chart-tooltip"
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-card border border-border bg-card px-3 py-1.5 text-small text-card-foreground shadow-sm"
            style={{ left: `${clampAnchor(currentPoint.x) / 10}%` }}
          >
            {describe(current, 'tooltip')}
          </div>
        ) : null}
      </div>
      <div data-testid="net-worth-announce" role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
