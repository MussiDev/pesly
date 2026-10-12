// @vitest-environment happy-dom
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NetWorthCard } from '../src/features/dashboard/components/net-worth-card';
import type { NetWorthView, SeriesPointView } from '../src/features/dashboard/dashboard-view';
import { formatCalendarDate } from '../src/features/credit-cards/format-dates';
import { formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp } from './support/render-app';

type SeriesProp = Parameters<typeof NetWorthCard>[0]['series'];

const NBSP = String.fromCharCode(0xa0);
const flat = (text: string) => text.replaceAll(NBSP, ' ');
const hasText = (expected: string) => (content: string) => flat(content).includes(flat(expected));
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

function netWorth(overrides: Partial<NetWorthView> = {}): NetWorthView {
  return {
    total: 142_000_000n,
    reason: null,
    ars: 100_000_000n,
    usd: 100_000n,
    holdingsWithoutPrice: 0,
    ...overrides,
  };
}

function series(count: number, total: (index: number) => bigint | null): SeriesPointView[] {
  return Array.from({ length: count }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    const value = total(index);
    return {
      date: `2025-${month}-28`,
      ars: BigInt(index + 1) * 100_000n,
      usd: BigInt(index + 1) * 1_000n,
      total: value,
      reason: value === null ? ('no_rate' as const) : null,
    };
  });
}

const ready = (points: SeriesPointView[]): SeriesProp => ({ kind: 'ready', points });

function renderCard(
  props: { netWorth?: NetWorthView; series?: SeriesProp; currency?: 'ARS' | 'USD' } = {},
  locale: 'es' | 'en' = 'en',
) {
  return renderApp(
    <NetWorthCard
      locale={locale}
      currency={props.currency ?? 'ARS'}
      netWorth={props.netWorth ?? netWorth()}
      series={props.series ?? ready(series(12, (i) => BigInt(i + 1) * 1_000_000n))}
    />,
    { locale },
  );
}

function rowAt(rows: HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (row === undefined) throw new Error(`No row at ${index}`);
  return row;
}

const tooltipText = () => flat(screen.getByTestId('chart-tooltip').textContent);

describe('NetWorthCard figures', () => {
  it('prints the total in English as 1,420,000.00 ARS (AC-01)', () => {
    renderCard();
    expect(screen.getByText(hasText('1,420,000.00 ARS'))).toBeDefined();
  });

  it('shows the ARS and USD parts on two separate lines and no converted sum (AC-04)', () => {
    renderCard({ netWorth: netWorth({ ars: 100_000_000n, usd: 100_000n, total: 5n }) });
    const ars = screen.getByText(hasText('1,000,000.00 ARS'));
    const usd = screen.getByText(hasText('1,000.00 USD'));
    expect(ars).not.toBe(usd);
    expect(ars.parentElement).not.toBe(usd.parentElement);
    expect(screen.getByText('In pesos')).toBeDefined();
    expect(screen.getByText('In dollars')).toBeDefined();
  });

  it('with a null total and no_rate shows both parts, the message and no total (AC-05)', () => {
    renderCard({
      netWorth: netWorth({ total: null, reason: 'no_rate' }),
      series: ready(series(3, () => null)),
    });
    expect(
      screen.getAllByText(CATALOGS.en.dashboard.netWorth.conversionUnavailable).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(hasText('1,000,000.00 ARS'))).toBeDefined();
    expect(screen.getByText(hasText('1,000.00 USD'))).toBeDefined();
    expect(screen.queryByText(hasText('1,420,000.00'))).toBeNull();
  });

  it('prints a zero total as 0.00 with no sign', () => {
    renderCard({
      netWorth: netWorth({ total: 0n, ars: 0n, usd: 0n }),
      series: ready(series(2, () => 0n)),
    });
    expect(screen.getAllByText(hasText('0.00 ARS')).length).toBeGreaterThan(0);
    expect(screen.queryByText(hasText('-0.00'))).toBeNull();
  });

  it('prints the total and the points in USD for a USD display currency (AC-50)', () => {
    renderCard({
      currency: 'USD',
      netWorth: netWorth({ total: 250_000n }),
      series: ready(series(3, (i) => BigInt(i + 1) * 10_000n)),
    });
    expect(screen.getByText(hasText('2,500.00 USD'))).toBeDefined();
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(flat(screen.getByRole('slider').getAttribute('aria-valuetext') ?? '')).toContain(
      '300.00 USD',
    );
  });

  it('says the last point may differ from the figure above', () => {
    renderCard();
    expect(screen.getByText(CATALOGS.en.dashboard.netWorth.lastPointNote)).toBeDefined();
  });

  it('renders Spanish strings, separators and dates (AC-47)', () => {
    renderCard({}, 'es');
    expect(
      screen.getByRole('heading', { level: 2, name: CATALOGS.es.dashboard.netWorth.label }),
    ).toBeDefined();
    expect(screen.getByText(hasText('1.420.000,00 ARS'))).toBeDefined();
    expect(screen.getByText(CATALOGS.es.dashboard.netWorth.ars)).toBeDefined();
    expect(document.querySelector('caption')?.textContent).toBe(
      CATALOGS.es.dashboard.chart.pointsCaption,
    );
    expect(screen.getAllByText(formatCalendarDate('2025-01-28', 'es')).length).toBeGreaterThan(0);
  });
});

describe('holdings without a price notice', () => {
  it('shows the count when above 0 (AC-31)', () => {
    renderCard({ netWorth: netWorth({ holdingsWithoutPrice: 2 }) });
    expect(screen.getByText('2 holdings have no price and are not counted.')).toBeDefined();
  });

  it('shows nothing at 0 (AC-31)', () => {
    renderCard({ netWorth: netWorth({ holdingsWithoutPrice: 0 }) });
    expect(screen.queryByText(/have no price|has no price/)).toBeNull();
  });
});

describe('net worth chart', () => {
  it('draws 12 dots for 12 converted points (AC-10)', () => {
    const { container } = renderCard();
    expect(container.querySelectorAll('circle')).toHaveLength(12);
    expect(container.querySelectorAll('[data-chart-line]')).toHaveLength(1);
  });

  it('draws dots only for points with a total', () => {
    const { container } = renderCard({
      series: ready(series(6, (i) => (i % 2 === 0 ? 5n : null))),
    });
    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });

  it('breaks the line at a gap of months without a total and keeps the table complete', () => {
    const { container } = renderCard({
      series: ready(series(9, (i) => (i >= 3 && i <= 5 ? null : BigInt(i + 1) * 1_000_000n))),
    });
    expect(container.querySelectorAll('circle')).toHaveLength(6);
    expect(container.querySelectorAll('[data-chart-line]')).toHaveLength(2);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(10);
  });

  it('with a single point shows the point value and no line (AC-11)', () => {
    const { container } = renderCard({ series: ready(series(1, () => 3_000_000n)) });
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chart-line]')).toHaveLength(0);
    expect(
      screen.getByText(
        hasText(
          fill(CATALOGS.en.dashboard.chart.singlePoint, {
            value: formatMoney(3_000_000n, 'ARS', 'en'),
          }),
        ),
      ),
    ).toBeDefined();
  });

  it('with no converted point shows no line, the message and the parts in the list (AC-12)', () => {
    const { container } = renderCard({
      netWorth: netWorth({ total: null, reason: 'no_rate' }),
      series: ready(series(2, () => null)),
    });
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelectorAll('[data-chart-line]')).toHaveLength(0);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText(CATALOGS.en.dashboard.chart.noConvertedPoint)).toBeDefined();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rowAt(rows, 1)).getByText(hasText('1,000.00 ARS'))).toBeDefined();
    expect(within(rowAt(rows, 1)).getByText(hasText('10.00 USD'))).toBeDefined();
    expect(
      within(rowAt(rows, 1)).getByText(CATALOGS.en.dashboard.netWorth.conversionUnavailable),
    ).toBeDefined();
  });

  it('renders an empty series with no error and an empty list', () => {
    const { container } = renderCard({
      netWorth: netWorth({ total: null, reason: 'no_rate' }),
      series: ready([]),
    });
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1);
  });

  it('draws a flat series with finite coordinates', () => {
    const { container } = renderCard({ series: ready(series(4, () => 9n)) });
    const d = container.querySelector('[data-chart-line]')?.getAttribute('d') ?? '';
    expect(d).not.toBe('');
    expect(d).not.toMatch(/NaN|Infinity/);
    for (const circle of container.querySelectorAll('circle')) {
      expect(Number.isFinite(Number(circle.getAttribute('cy')))).toBe(true);
    }
  });

  it('uses theme tokens for the line and the area', () => {
    const { container } = renderCard();
    expect(container.querySelector('[data-chart-line]')?.getAttribute('class')).toContain(
      'stroke-chart-2',
    );
    expect(container.querySelector('[data-chart-area]')?.getAttribute('class')).toContain(
      'fill-chart-2/15',
    );
  });

  it('shows a tooltip with the date and value on arrow keys, Home and End (AC-13)', () => {
    renderCard({ series: ready(series(3, (i) => BigInt(i + 1) * 1_000_000n)) });
    const slider = screen.getByRole('slider');
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    const expected = (index: number) =>
      flat(
        fill(CATALOGS.en.dashboard.chart.tooltip, {
          date: formatCalendarDate(`2025-0${index + 1}-28`, 'en'),
          value: formatMoney(BigInt(index + 1) * 1_000_000n, 'ARS', 'en'),
        }),
      );
    fireEvent.focus(slider);
    expect(tooltipText()).toBe(expected(2));
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(tooltipText()).toBe(expected(1));
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(tooltipText()).toBe(expected(0));
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(tooltipText()).toBe(expected(0));
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(tooltipText()).toBe(expected(2));
    expect(flat(slider.getAttribute('aria-valuetext') ?? '')).toBe(expected(2));
  });

  it('shows the tooltip for a pointer position and ignores one outside the plot', () => {
    renderCard({ series: ready(series(3, (i) => BigInt(i + 1) * 1_000_000n)) });
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () =>
      ({
        left: 10,
        width: 200,
        top: 0,
        height: 100,
        right: 210,
        bottom: 100,
        x: 10,
        y: 0,
      }) as DOMRect;
    fireEvent.pointerMove(slider, { clientX: 10 });
    expect(tooltipText()).toContain(formatCalendarDate('2025-01-28', 'en'));
    fireEvent.pointerMove(slider, { clientX: 400 });
    expect(tooltipText()).toContain(formatCalendarDate('2025-01-28', 'en'));
    fireEvent.click(slider, { clientX: 210 });
    expect(tooltipText()).toContain(formatCalendarDate('2025-03-28', 'en'));
  });

  it('dismisses the tooltip on Escape and keeps the focus', () => {
    renderCard();
    const slider = screen.getByRole('slider');
    fireEvent.focus(slider);
    expect(screen.getByTestId('chart-tooltip')).toBeDefined();
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(screen.getByTestId('chart-tooltip')).toBeDefined();
  });

  it('moves by a page with PageUp and PageDown and stops at the ends', () => {
    renderCard({ series: ready(series(12, (i) => BigInt(i + 1) * 1_000_000n)) });
    const slider = screen.getByRole('slider');
    fireEvent.focus(slider);
    expect(slider.getAttribute('aria-valuenow')).toBe('11');
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(slider.getAttribute('aria-valuenow')).toBe('8');
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(slider.getAttribute('aria-valuenow')).toBe('11');
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(slider.getAttribute('aria-valuenow')).toBe('11');
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
  });

  it('hides the tooltip on blur', () => {
    renderCard();
    const slider = screen.getByRole('slider');
    fireEvent.focus(slider);
    expect(screen.getByTestId('chart-tooltip')).toBeDefined();
    fireEvent.blur(slider);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('has a focusable, labeled slider with a 44 px target (NFR-08)', () => {
    renderCard();
    const slider = screen.getByRole('slider', { name: CATALOGS.en.dashboard.chart.name });
    expect(slider.getAttribute('tabindex')).toBe('0');
    expect(slider.className).toContain('min-h-11');
  });
});

describe('points list', () => {
  it('has a caption and one row per point with the date and the value or the parts (AC-14)', () => {
    renderCard({ series: ready(series(4, (i) => (i === 2 ? null : BigInt(i + 1) * 1_000_000n))) });
    const table = screen.getByRole('table');
    expect(table.querySelector('caption')?.textContent).toBe(
      CATALOGS.en.dashboard.chart.pointsCaption,
    );
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(within(rowAt(rows, 1)).getByText(formatCalendarDate('2025-01-28', 'en'))).toBeDefined();
    expect(within(rowAt(rows, 1)).getByText(hasText('10,000.00 ARS'))).toBeDefined();
    expect(within(rowAt(rows, 3)).getByText(hasText('3,000.00 ARS'))).toBeDefined();
    expect(within(rowAt(rows, 3)).getByText(hasText('30.00 USD'))).toBeDefined();
    expect(
      within(rowAt(rows, 3)).getByText(CATALOGS.en.dashboard.netWorth.conversionUnavailable),
    ).toBeDefined();
  });
});

describe('series failure', () => {
  it('shows the retry in place of the chart and calls it once on a double tap (AC-34)', () => {
    const onRetry = vi.fn();
    const { container } = renderCard({ series: { kind: 'failed', retrying: false, onRetry } });
    expect(screen.getByText(hasText('1,420,000.00 ARS'))).toBeDefined();
    expect(screen.getByText(CATALOGS.en.dashboard.chart.failed)).toBeDefined();
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    const retry = screen.getByRole('button', { name: CATALOGS.en.dashboard.chart.retry });
    expect(retry.className).toContain('min-h-11');
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the retry while retrying', () => {
    const onRetry = vi.fn();
    renderCard({ series: { kind: 'failed', retrying: true, onRetry } });
    const retry = screen.getByRole('button', { name: CATALOGS.en.dashboard.chart.retry });
    expect(retry.hasAttribute('disabled')).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('allows another retry after a failed attempt finishes', () => {
    const onRetry = vi.fn();
    const view = renderCard({ series: { kind: 'failed', retrying: false, onRetry } });
    fireEvent.click(screen.getByRole('button', { name: CATALOGS.en.dashboard.chart.retry }));
    const next = (retrying: boolean) => (
      <NetWorthCard
        locale="en"
        currency="ARS"
        netWorth={netWorth()}
        series={{ kind: 'failed', retrying, onRetry }}
      />
    );
    view.rerender(next(true));
    view.rerender(next(false));
    fireEvent.click(screen.getByRole('button', { name: CATALOGS.en.dashboard.chart.retry }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
