'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { formatCalendarDate } from '@/features/credit-cards/format-dates';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import type { Currency, SeriesPointView } from '../dashboard-view';
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  clampAnchor,
  clampIndex,
  drawnPoints,
  indexFromPosition,
  toSvgX,
  toSvgY,
} from './chart-geometry';

/**
 * The net worth over time as an SVG area and line. The plot is one slider: pointer, tap and keys
 * select a drawn point and show its date and value.
 */
export function NetWorthChart({
  locale,
  currency,
  points,
}: {
  locale: Locale;
  currency: Currency;
  points: readonly SeriesPointView[];
}) {
  const t = useTranslations('dashboard.chart');
  const drawn = drawnPoints(points);
  const [selected, setSelected] = useState<number | null>(null);
  const focused = useRef(false);

  if (drawn.length === 0) {
    return <p className="text-small text-muted-foreground">{t('noConvertedPoint')}</p>;
  }

  const count = drawn.length;
  const current = clampIndex(selected ?? count - 1, count);
  const currentPoint = drawn[current];
  const describe = (index: number) => {
    const point = drawn[clampIndex(index, count)];
    return point === undefined
      ? ''
      : t('tooltip', {
          date: formatCalendarDate(point.date, locale),
          value: formatMoney(point.value, currency, locale),
        });
  };

  const coordinates = drawn.map((point) => ({ x: toSvgX(point.x), y: toSvgY(point.y) }));
  const line = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`)
    .join(' ');
  const first = coordinates[0];
  const last = coordinates[count - 1];
  const area =
    first === undefined || last === undefined
      ? ''
      : `${line} L${last.x} ${VIEW_HEIGHT} L${first.x} ${VIEW_HEIGHT} Z`;

  const selectAt = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const index = indexFromPosition(clientX - rect.left, rect.width, count);
    if (index !== null) setSelected(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowDown: current - 1,
      ArrowRight: current + 1,
      ArrowUp: current + 1,
      Home: 0,
      End: count - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSelected(clampIndex(next, count));
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative min-w-0">
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('name')}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={current}
          aria-valuetext={describe(current)}
          className="min-h-11 w-full min-w-0 touch-pan-y rounded-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onFocus={() => {
            focused.current = true;
            setSelected((value) => value ?? count - 1);
          }}
          onBlur={() => {
            focused.current = false;
            setSelected(null);
          }}
          onKeyDown={onKeyDown}
          onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
            selectAt(event.clientX, event.currentTarget);
          }}
          onPointerLeave={() => {
            if (!focused.current) setSelected(null);
          }}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            selectAt(event.clientX, event.currentTarget);
          }}
        >
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="block h-auto w-full"
            aria-hidden="true"
            focusable="false"
          >
            {count > 1 ? (
              <>
                <path data-chart-area d={area} className="fill-chart-2/15 stroke-none" />
                <path
                  data-chart-line
                  d={line}
                  fill="none"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  className="stroke-chart-2"
                />
              </>
            ) : null}
            {coordinates.map(({ x, y }, index) => (
              <circle
                key={drawn[index]?.date ?? index}
                cx={x}
                cy={y}
                r={index === current && selected !== null ? 9 : 6}
                className="fill-chart-2"
              />
            ))}
          </svg>
        </div>
        {selected !== null && currentPoint !== undefined ? (
          <div
            data-testid="chart-tooltip"
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-card border border-border bg-card px-3 py-1.5 text-small text-card-foreground shadow-sm"
            style={{ left: `${clampAnchor(currentPoint.x) / 10}%` }}
          >
            {describe(current)}
          </div>
        ) : null}
      </div>
      {count === 1 && currentPoint !== undefined ? (
        <p className="text-small text-muted-foreground">
          {t('singlePoint', { value: formatMoney(currentPoint.value, currency, locale) })}
        </p>
      ) : null}
    </div>
  );
}
