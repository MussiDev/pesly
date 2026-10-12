// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatCalendarDate } from '../src/features/credit-cards/format-dates';
import { NetWorthContainer } from '../src/features/reports/net-worth/net-worth-container';
import { NetWorthScreen } from '../src/features/reports/net-worth/net-worth-screen';
import { NetWorthSkeleton } from '../src/features/reports/net-worth/net-worth-skeleton';
import type { ReportState } from '../src/features/reports/use-report';
import type { NetWorthPointView, NetWorthView } from '../src/features/reports/report-view';
import { formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const NBSP = String.fromCharCode(0xa0);
const flat = (text: string | null) => (text ?? '').replaceAll(NBSP, ' ');
const money = (value: bigint, currency: 'ARS' | 'USD', locale: 'en' | 'es' = 'en') =>
  flat(formatMoney(value, currency, locale));
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

function point(over: Partial<NetWorthPointView> & { date: string }): NetWorthPointView {
  return { ars: 0n, usd: 0n, total: 0n, reason: null, incomplete: false, ...over };
}

function view(points: NetWorthPointView[], currency: 'ARS' | 'USD' = 'ARS'): NetWorthView {
  return { currency, from: '2026-04-01', to: '2026-09-30', points };
}

const SERIES: NetWorthPointView[] = [
  point({ date: '2026-04-30', ars: 500_000_00n, usd: 100_00n, total: 600_000_00n }),
  point({ date: '2026-05-31', ars: 700_000_00n, usd: 200_00n, total: 800_000_00n }),
  point({ date: '2026-06-30', ars: 1_000_000_00n, usd: 500_00n, total: 1_500_000_00n }),
];

function renderScreen(
  state: ReportState<NetWorthView>,
  extra: { locale?: 'en' | 'es'; onRetry?: () => void; onFiltersChange?: () => void } = {},
) {
  const locale = extra.locale ?? 'en';
  return renderApp(
    <NetWorthScreen
      locale={locale}
      state={state}
      filters={{}}
      today="2026-10-12"
      onFiltersChange={extra.onFiltersChange ?? vi.fn()}
      onRetry={extra.onRetry ?? vi.fn()}
      onWiden={vi.fn()}
    />,
    { locale },
  );
}

const ready = (points: NetWorthPointView[], currency: 'ARS' | 'USD' = 'ARS') =>
  ({ status: 'ready', data: view(points, currency) }) as const;

function withRect(el: HTMLElement) {
  el.getBoundingClientRect = () =>
    ({ left: 0, width: 200, top: 0, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect;
}

describe('NetWorthScreen selection', () => {
  it('shows a tooltip with the date and the converted total on pointer and tap (AC-18)', () => {
    renderScreen(ready(SERIES));
    const slider = screen.getByRole('slider');
    withRect(slider);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    fireEvent.pointerMove(slider, { clientX: 0 });
    const expected = flat(
      fill(en.reports.netWorth.tooltip, {
        date: formatCalendarDate('2026-04-30', 'en'),
        value: money(600_000_00n, 'ARS'),
      }),
    );
    expect(flat(screen.getByTestId('chart-tooltip').textContent)).toBe(expected);
    fireEvent.click(slider, { clientX: 200 });
    expect(flat(screen.getByTestId('chart-tooltip').textContent)).toContain(
      formatCalendarDate('2026-06-30', 'en'),
    );
  });

  it('moves the selection with the arrows and announces date and value (AC-19)', () => {
    renderScreen(ready(SERIES));
    const slider = screen.getByRole('slider');
    const announce = (date: string, value: bigint) =>
      flat(
        fill(en.reports.netWorth.announce, {
          date: formatCalendarDate(date, 'en'),
          value: money(value, 'ARS'),
        }),
      );
    fireEvent.focus(slider);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(flat(screen.getByTestId('net-worth-announce').textContent)).toBe(
      announce('2026-05-31', 800_000_00n),
    );
    expect(flat(slider.getAttribute('aria-valuetext'))).toBe(announce('2026-05-31', 800_000_00n));
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(flat(slider.getAttribute('aria-valuetext'))).toBe(announce('2026-06-30', 1_500_000_00n));
  });

  it('a key press at either end changes nothing', () => {
    renderScreen(ready(SERIES));
    const slider = screen.getByRole('slider');
    fireEvent.focus(slider);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuenow')).toBe('2');
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
  });

  it('shows ARS and USD in their own currency next to the total (AC-20)', () => {
    renderScreen(ready(SERIES));
    const slider = screen.getByRole('slider');
    fireEvent.focus(slider);
    const detail = screen.getByTestId('net-worth-detail');
    expect(flat(detail.textContent)).toContain(formatCalendarDate('2026-06-30', 'en'));
    expect(flat(detail.textContent)).toContain(money(1_000_000_00n, 'ARS'));
    expect(flat(detail.textContent)).toContain(money(500_00n, 'USD'));
    expect(flat(detail.textContent)).toContain(money(1_500_000_00n, 'ARS'));
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(flat(screen.getByTestId('net-worth-detail').textContent)).toContain(
      money(200_00n, 'USD'),
    );
  });
});

describe('NetWorthScreen gaps and fallbacks', () => {
  const GAP = [
    SERIES[0] as NetWorthPointView,
    point({ date: '2026-05-31', ars: 1n, usd: 2n, total: null, reason: 'no_rate' }),
    SERIES[2] as NetWorthPointView,
  ];

  it('leaves a gap for a null total and says no exchange rate exists (AC-21)', () => {
    const { container } = renderScreen(ready(GAP));
    // Two isolated months: nothing to join, so no line segment is drawn across the gap.
    expect(container.querySelectorAll('[data-chart-line]')).toHaveLength(0);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    const list = screen.getByRole('list', { name: en.reports.netWorth.listName });
    expect(within(list).getByText(en.reports.netWorth.noRate)).toBeDefined();
  });

  it('joins consecutive months with a line', () => {
    const { container } = renderScreen(ready(SERIES));
    expect(container.querySelectorAll('[data-chart-line]')).toHaveLength(1);
  });

  it('with no total at all lists ARS and USD per month and no chart (AC-22)', () => {
    const none = [
      point({ date: '2026-04-30', ars: 10_00n, usd: 3_00n, total: null, reason: 'no_rate' }),
      point({ date: '2026-05-31', ars: 20_00n, usd: 4_00n, total: null, reason: 'no_rate' }),
    ];
    renderScreen(ready(none));
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText(en.reports.netWorth.conversionUnavailable)).toBeDefined();
    const list = screen.getByRole('list', { name: en.reports.netWorth.listName });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(flat(list.textContent)).toContain(money(20_00n, 'ARS'));
    expect(flat(list.textContent)).toContain(money(4_00n, 'USD'));
  });

  it('flags a point with incomplete investments (AC-23)', () => {
    const incomplete = [
      SERIES[0] as NetWorthPointView,
      { ...(SERIES[1] as NetWorthPointView), incomplete: true },
    ];
    renderScreen(ready(incomplete));
    expect(screen.queryByTestId('net-worth-detail')).toBeNull();
    fireEvent.focus(screen.getByRole('slider'));
    expect(screen.getByTestId('net-worth-detail').textContent).toContain(
      en.reports.netWorth.investmentsIncomplete,
    );
  });

  it('an all-equal series draws a flat line', () => {
    const flatSeries = SERIES.map((p) => ({ ...p, total: 5_00n }));
    const { container } = renderScreen(ready(flatSeries));
    expect(container.querySelector('[data-chart-line]')?.getAttribute('d')).not.toContain('NaN');
  });

  it('draws only the last 24 points of a longer series', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      point({
        date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-28`,
        total: BigInt(i + 1) * 100n,
      }),
    );
    const { container } = renderScreen(ready(many));
    expect(container.querySelectorAll('circle')).toHaveLength(24);
    const list = screen.getByRole('list', { name: en.reports.netWorth.listName });
    expect(within(list).getAllByRole('listitem')).toHaveLength(24);
  });
});

describe('NetWorthScreen filters and accessibility', () => {
  it('offers the date range only, no account or tag control (AC-25)', () => {
    renderScreen(ready(SERIES));
    expect(screen.getByLabelText(en.reports.range.from)).toBeDefined();
    expect(screen.queryByLabelText(en.reports.filters.account)).toBeNull();
    expect(screen.queryByLabelText(en.reports.filters.tag)).toBeNull();
    expect(screen.queryByText(en.reports.notices.filtered)).toBeNull();
    expect(screen.getByText(en.reports.currency.changeLink)).toBeDefined();
  });

  it('repeats every point in a text list and hides the drawing (AC-45, AC-46)', () => {
    const { container } = renderScreen(ready(SERIES));
    const list = screen.getByRole('list', { name: en.reports.netWorth.listName });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(flat(list.textContent)).toContain(money(800_000_00n, 'ARS'));
    const figure = screen.getByRole('figure', { name: en.reports.netWorth.chartName });
    expect(figure.textContent).toContain(formatCalendarDate('2026-04-01', 'en'));
    expect(figure.textContent).toContain('3 points');
    expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders the Spanish catalog and amounts', () => {
    renderScreen(ready(SERIES), { locale: 'es' });
    const list = screen.getByRole('list', { name: es.reports.netWorth.listName });
    expect(flat(list.textContent)).toContain(money(800_000_00n, 'ARS', 'es'));
  });

  it('escapes nothing by hand: text is plain React text', () => {
    const { container } = renderScreen(ready(SERIES));
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('NetWorthScreen states', () => {
  it('shows the error state with retry and no figures', () => {
    const onRetry = vi.fn();
    renderScreen({ status: 'failed', retrying: false }, { onRetry });
    fireEvent.click(screen.getByRole('button', { name: en.reports.states.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('shows the offline state', () => {
    renderScreen({ status: 'offline' });
    expect(screen.getByText(en.reports.states.offlineTitle)).toBeDefined();
  });

  it('shows the range alert for a bad range and no figures', () => {
    renderScreen({ status: 'badRange', field: 'to', reason: 'server' });
    expect(screen.getByText(en.reports.states.badRangeMessage)).toBeDefined();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('shows the empty state for a series with no points', () => {
    renderScreen(ready([]));
    expect(screen.getByText(en.reports.states.emptyTitle)).toBeDefined();
  });

  it('shows the loading skeleton with the final layout', () => {
    renderScreen({ status: 'loading' });
    expect(screen.getByText(en.reports.states.loading)).toBeDefined();
  });

  it('the skeleton renders on its own', () => {
    renderApp(<NetWorthSkeleton />);
    expect(document.querySelector('[data-testid="net-worth-skeleton"]')).not.toBeNull();
  });
});

describe('NetWorthContainer', () => {
  const body = {
    currency: 'ARS',
    from: '2026-04-01',
    to: '2026-09-30',
    points: [
      {
        date: '2026-06-30',
        ars: '100000000',
        usd: '50000',
        total: '150000000',
        reason: null,
        investmentsIncomplete: false,
      },
    ],
  };

  it('requests the series once and shows its figures', async () => {
    const { calls } = stubApi({ 'GET /reports/net-worth': { status: 200, body } });
    renderApp(<NetWorthContainer />, { locale: 'en', pathname: '/en/reports/net-worth' });
    expect(await screen.findByRole('slider')).toBeDefined();
    expect(calls.filter((call) => call.path.startsWith('/reports/net-worth'))).toHaveLength(1);
  });

  it('sends the range from the address', async () => {
    const { calls } = stubApi({
      'GET /reports/net-worth?from=2026-01-01&to=2026-09-30': { status: 200, body },
    });
    renderApp(<NetWorthContainer />, { search: 'from=2026-01-01&to=2026-09-30&tag=x&accountId=y' });
    await screen.findByRole('slider');
    expect(calls.map((call) => call.path)).toContain(
      '/reports/net-worth?from=2026-01-01&to=2026-09-30',
    );
  });

  it('a 401 sends the user to sign-in and shows no figures (AC-48)', async () => {
    stubApi({
      'GET /reports/net-worth': { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<NetWorthContainer />, { pathname: '/es/reports/net-worth' });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(expect.stringContaining('/sign-in'));
    });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByText(es.reports.states.errorTitle)).toBeNull();
  });

  it('a network failure shows the error state with retry', async () => {
    stubApi({ 'GET /reports/net-worth': 'network-error' });
    renderApp(<NetWorthContainer />, { locale: 'en' });
    expect(await screen.findByText(en.reports.states.errorTitle)).toBeDefined();
  });
});
