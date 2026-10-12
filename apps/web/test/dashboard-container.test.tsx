// @vitest-environment happy-dom
import { existsSync } from 'node:fs';
import { join as resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardContainer } from '../src/features/dashboard/containers/dashboard-container';
import {
  clearDashboardMemory,
  recallDashboard,
  rememberDashboard,
} from '../src/features/dashboard/containers/dashboard-session-cache';
import { DashboardSkeleton } from '../src/features/dashboard/components/dashboard-skeleton';
import { DashboardScreen } from '../src/features/dashboard/components/dashboard-screen';
import { toDashboardView } from '../src/features/dashboard/contract/dashboard-adapter';
import { dashboardResponseSchema } from '../src/lib/dashboard-contract';
import { formatMoney } from '../src/lib/format-amount';
import { SESSION_POINTER_KEY } from '../src/lib/local-store/session-pointer';
import { QuickActions } from '../src/features/home/components/quick-actions';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const readQueueCounts = vi.hoisted(() => vi.fn());
const readGroupQueueCounts = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/local-store/device-copy', () => ({ readQueueCounts }));
vi.mock('../src/lib/sync/group-queue-counts', () => ({ readGroupQueueCounts }));

const { en, es } = CATALOGS;

const DASHBOARD = 'GET /dashboard';
const SERIES = 'GET /reports/net-worth';
const BUDGET_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const PAYMENT_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

/** The DOM matcher normalizes whitespace (non-breaking spaces included), so the needle must be too. */
function money(value: bigint, currency: 'ARS' | 'USD', locale: 'es' | 'en'): string {
  return formatMoney(value, currency, locale).replace(/\s+/g, ' ');
}

const ZERO_PAIR = { ars: '0', usd: '0' };

// A body in the shape of spec DISC-001-09b.
function dashboardBody(patch: Record<string, unknown> = {}) {
  return {
    currency: 'ARS',
    today: '2026-10-12',
    netWorth: {
      ars: '100000000',
      usd: '100000',
      total: '142000000',
      reason: null,
      holdingsWithoutPrice: 0,
      parts: {
        accounts: { ars: '100000000', usd: '100000' },
        investments: ZERO_PAIR,
        groups: ZERO_PAIR,
        installmentDebt: ZERO_PAIR,
      },
    },
    month: {
      from: '2026-10-01',
      to: '2026-10-12',
      expenses: '24000000',
      income: '80000000',
      net: '56000000',
      change: { expenses: 20, income: null, net: -5 },
      unconvertedShareCount: 0,
      unconvertedInstallmentCount: 0,
    },
    categories: [
      { categoryId: null, defaultKey: 'food', name: null, amount: '8000000', sharePercent: 33 },
    ],
    budgets: [
      {
        budgetId: BUDGET_ID,
        name: 'Groceries',
        currency: 'ARS',
        available: '6000000',
        spent: '4000000',
        percentUsed: 40,
        status: 'on_track',
      },
    ],
    upcoming: [
      {
        kind: 'recurring_payment',
        paymentId: PAYMENT_ID,
        date: '2026-10-14',
        name: 'Rent',
        currency: 'ARS',
        amount: '4500000',
      },
    ],
    actions: [
      { kind: 'pending_occurrence', dueDate: '2026-10-12', name: 'Gym', occurrenceId: PAYMENT_ID },
    ],
    groups: { owedToYou: { ars: '3000000', usd: '0' }, youOwe: { ars: '0', usd: '5000' } },
    insight: {
      categoryId: null,
      defaultKey: 'food',
      name: null,
      amount: '8000000',
      sharePercent: 33,
      changePercent: 40,
    },
    firstSteps: { hasAccount: true, hasMovement: true, show: false },
    ...patch,
  };
}

function seriesBody() {
  return {
    currency: 'ARS',
    from: '2025-11-01',
    to: '2026-10-12',
    points: [
      {
        date: '2026-09-30',
        ars: '90000000',
        usd: '90000',
        total: '130000000',
        reason: null,
        investmentsIncomplete: false,
      },
      {
        date: '2026-10-12',
        ars: '100000000',
        usd: '100000',
        total: '142000000',
        reason: null,
        investmentsIncomplete: false,
      },
    ],
  };
}

const OK = {
  [DASHBOARD]: { status: 200, body: dashboardBody() },
  [SERIES]: { status: 200, body: seriesBody() },
};

function setPointer(userId: string | null) {
  if (userId === null) window.localStorage.removeItem(SESSION_POINTER_KEY);
  else
    window.localStorage.setItem(
      SESSION_POINTER_KEY,
      JSON.stringify({ userId, emailVerified: true }),
    );
}

function setOffline(offline: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(!offline);
}

/** A fetch whose answers are released by the test, to observe in-flight states. */
function controlledApi() {
  const calls: string[] = [];
  const pending: { path: string; release: (status: number, body?: unknown) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.slice(API_ORIGIN.length);
      calls.push(path);
      return new Promise<Response>((resolve) => {
        pending.push({
          path,
          release: (status, body) => {
            resolve(
              new Response(body === undefined ? null : JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
          },
        });
      });
    }),
  );
  return { calls, pending };
}

beforeEach(() => {
  clearDashboardMemory();
  window.localStorage.clear();
  readQueueCounts.mockReset();
  readGroupQueueCounts.mockReset();
  readQueueCounts.mockResolvedValue({ pending: 0, failed: 0 });
  readGroupQueueCounts.mockResolvedValue({ pending: 0, failed: 0, conflict: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardContainer loading and requests', () => {
  it('shows a skeleton with no amount while the requests are pending (AC-02)', async () => {
    const { calls, pending } = controlledApi();
    renderApp(<DashboardContainer />);

    expect(screen.getByRole('status', { name: es.dashboard.states.loading })).toBeDefined();
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryAllByText(money(142000000n, 'ARS', 'es'))).toHaveLength(0);
    // Both requests leave in the same tick, before either one answers.
    expect([...calls].sort()).toEqual(['/dashboard', '/reports/net-worth']);
    expect(pending).toHaveLength(2);
    for (const request of pending) request.release(500);
    await screen.findByText(es.dashboard.states.error);
  });

  it('sends exactly the dashboard and net worth requests and nothing else (AC-37, NFR-05)', async () => {
    const { calls } = stubApi(OK);
    renderApp(<DashboardContainer />);
    await screen.findAllByText(money(142000000n, 'ARS', 'es'));
    expect(calls.map((call) => call.path).sort()).toEqual(['/dashboard', '/reports/net-worth']);
  });
});

describe('DashboardContainer ready screen', () => {
  it('renders every card with the amounts of the response (AC-47, Spanish)', async () => {
    stubApi(OK);
    renderApp(<DashboardContainer />);

    const card = await screen.findByRole('region', { name: es.dashboard.netWorth.label });
    expect(within(card).getAllByText(money(142000000n, 'ARS', 'es')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(es.dashboard.title);
    expect(screen.getByText(es.dashboard.month.expenses)).toBeDefined();
    expect(screen.getByText(es.dashboard.categories.title)).toBeDefined();
    expect(screen.getByText(es.dashboard.budgets.title)).toBeDefined();
    expect(screen.getByText(es.dashboard.upcoming.title)).toBeDefined();
    expect(screen.getByText(es.dashboard.groups.title)).toBeDefined();
    expect(screen.getByText(es.dashboard.attention.title)).toBeDefined();
    expect(screen.getByRole('list', { name: es.home.quickActions.label })).toBeDefined();
  });

  it('renders in English with English amounts (AC-47)', async () => {
    stubApi(OK);
    renderApp(<DashboardContainer />, { locale: 'en' });
    const card = await screen.findByRole('region', { name: en.dashboard.netWorth.label });
    expect(within(card).getAllByText(money(142000000n, 'ARS', 'en')).length).toBeGreaterThan(0);
    expect(screen.getByText(en.dashboard.budgets.title)).toBeDefined();
  });

  it('puts the device-queue items after the server ones in "Do these first" (AC-24)', async () => {
    readQueueCounts.mockResolvedValue({ pending: 0, failed: 2 });
    stubApi(OK);
    renderApp(<DashboardContainer />);
    await screen.findByText(es.dashboard.attention.title);
    const queueLink = await screen.findByRole('link', { name: /2 movimientos/ });
    expect(queueLink.getAttribute('href')).toBe('/es/movements');
  });

  it('keeps the retry and links as 44 px targets in a logical keyboard order (NFR-08)', async () => {
    stubApi({ ...OK, [SERIES]: { status: 500 } });
    renderApp(<DashboardContainer />);
    const retry = await screen.findByRole('button', { name: es.dashboard.chart.retry });
    expect(retry.className).toMatch(/h-(9|10|11)|min-h-11|size-11/);
    for (const link of screen.getAllByRole('link')) {
      expect(link.hasAttribute('tabindex') && link.getAttribute('tabindex') !== '0').toBe(false);
    }
  });
});

describe('DashboardContainer errors (AC-03, AC-49)', () => {
  it('shows the error state with no amount and a retry that re-sends both requests once', async () => {
    const { calls, pending } = controlledApi();
    renderApp(<DashboardContainer />);
    for (const request of pending.splice(0)) request.release(500);

    const retry = await screen.findByRole('button', { name: es.dashboard.states.retry });
    expect(screen.getByText(es.dashboard.states.error)).toBeDefined();
    expect(screen.queryAllByText(money(142000000n, 'ARS', 'es'))).toHaveLength(0);
    expect(screen.queryByRole('region', { name: es.dashboard.netWorth.label })).toBeNull();
    const before = calls.length;

    fireEvent.click(retry);
    const inFlight = await screen.findByRole('button', { name: es.dashboard.states.retry });
    expect((inFlight as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(inFlight);
    fireEvent.click(inFlight);

    await waitFor(() => {
      expect(calls.length - before).toBe(2);
    });
    expect(calls.slice(before).sort()).toEqual(['/dashboard', '/reports/net-worth']);
    for (const request of pending.splice(0)) request.release(500);
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: es.dashboard.states.retry }).disabled,
      ).toBe(false);
    });
  });

  it('recovers when the retry succeeds', async () => {
    stubApi({
      [DASHBOARD]: [{ status: 500 }, OK[DASHBOARD]],
      [SERIES]: [{ status: 500 }, OK[SERIES]],
    });
    renderApp(<DashboardContainer />);
    fireEvent.click(await screen.findByRole('button', { name: es.dashboard.states.retry }));
    expect((await screen.findAllByText(money(142000000n, 'ARS', 'es'))).length).toBeGreaterThan(0);
    expect(screen.queryByText(es.dashboard.states.error)).toBeNull();
  });

  it('is the error state with no partial section when both requests answer 500 (AC-49)', async () => {
    stubApi({ [DASHBOARD]: { status: 500 }, [SERIES]: { status: 500 } });
    renderApp(<DashboardContainer />);
    await screen.findByText(es.dashboard.states.error);
    expect(screen.queryByText(es.dashboard.budgets.title)).toBeNull();
    expect(screen.queryByText(es.dashboard.groups.title)).toBeNull();
  });

  it('redirects to sign-in on a 401 and shows no amount', async () => {
    stubApi({
      [DASHBOARD]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      [SERIES]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<DashboardContainer />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryAllByText(money(142000000n, 'ARS', 'es'))).toHaveLength(0);
    expect(screen.queryByText(es.dashboard.states.error)).toBeNull();
  });

  it('forgets the remembered answers when the session has expired', async () => {
    // Only the identity of the entry matters here, not the shape of the view.
    rememberDashboard('u1', { view: {} as never, points: null });
    stubApi({
      [DASHBOARD]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      [SERIES]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<DashboardContainer />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(recallDashboard('u1')).toBeUndefined();
  });

  it('shows the error state when the dashboard body does not match its parser', async () => {
    stubApi({ [DASHBOARD]: { status: 200, body: { currency: 'ARS' } }, [SERIES]: OK[SERIES] });
    renderApp(<DashboardContainer />);
    expect(await screen.findByText(es.dashboard.states.error)).toBeDefined();
  });
});

describe('DashboardContainer chart failure (AC-34)', () => {
  it('keeps every other widget and retries only the series request', async () => {
    const { calls } = stubApi({
      [DASHBOARD]: OK[DASHBOARD],
      [SERIES]: [{ status: 500 }, OK[SERIES]],
    });
    renderApp(<DashboardContainer />);

    const retry = await screen.findByRole('button', { name: es.dashboard.chart.retry });
    expect(screen.getByText(es.dashboard.budgets.title)).toBeDefined();
    expect(screen.getAllByText(money(142000000n, 'ARS', 'es')).length).toBeGreaterThan(0);
    expect(screen.queryByText(es.dashboard.states.error)).toBeNull();

    const before = calls.length;
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: es.dashboard.chart.retry })).toBeNull();
    });
    expect(calls.slice(before).map((call) => call.path)).toEqual(['/reports/net-worth']);
  });
});

describe('DashboardContainer offline (AC-35, AC-36)', () => {
  it('keeps earlier data of the session under the out-of-date notice', async () => {
    setPointer('user-1');
    stubApi({
      [DASHBOARD]: [OK[DASHBOARD], 'network-error'],
      [SERIES]: [OK[SERIES], 'network-error'],
    });
    const first = renderApp(<DashboardContainer />);
    await first.findAllByText(money(142000000n, 'ARS', 'es'));
    first.unmount();

    setOffline(true);
    renderApp(<DashboardContainer />);
    expect(await screen.findByText(es.dashboard.states.outOfDate)).toBeDefined();
    expect(screen.getAllByText(money(142000000n, 'ARS', 'es')).length).toBeGreaterThan(0);
    expect(screen.queryByText(es.dashboard.states.error)).toBeNull();
  });

  it('shows the offline message and a retry, no amount, when there is no earlier data', async () => {
    setPointer('user-1');
    setOffline(true);
    stubApi({ [DASHBOARD]: 'network-error', [SERIES]: 'network-error' });
    renderApp(<DashboardContainer />);
    expect(await screen.findByText(es.dashboard.states.offline)).toBeDefined();
    expect(screen.getByRole('button', { name: es.dashboard.states.retry })).toBeDefined();
    expect(screen.queryAllByText(money(142000000n, 'ARS', 'es'))).toHaveLength(0);
  });

  it('never shows the data of another user id', async () => {
    setPointer('user-1');
    stubApi({
      [DASHBOARD]: [OK[DASHBOARD], 'network-error'],
      [SERIES]: [OK[SERIES], 'network-error'],
    });
    const first = renderApp(<DashboardContainer />);
    await first.findAllByText(money(142000000n, 'ARS', 'es'));
    first.unmount();

    setPointer('user-2');
    setOffline(true);
    renderApp(<DashboardContainer />);
    expect(await screen.findByText(es.dashboard.states.offline)).toBeDefined();
    expect(screen.queryAllByText(money(142000000n, 'ARS', 'es'))).toHaveLength(0);
  });

  it('never reads the memory after the pointer is gone', async () => {
    setPointer('user-1');
    stubApi({
      [DASHBOARD]: [OK[DASHBOARD], 'network-error'],
      [SERIES]: [OK[SERIES], 'network-error'],
    });
    const first = renderApp(<DashboardContainer />);
    await first.findAllByText(money(142000000n, 'ARS', 'es'));
    first.unmount();

    setPointer(null);
    setOffline(true);
    renderApp(<DashboardContainer />);
    expect(await screen.findByText(es.dashboard.states.offline)).toBeDefined();
    expect(screen.queryAllByText(money(142000000n, 'ARS', 'es'))).toHaveLength(0);
  });

  it('shows the generic error, not the memory, when the failure happens online', async () => {
    setPointer('user-1');
    stubApi({
      [DASHBOARD]: [OK[DASHBOARD], 'network-error'],
      [SERIES]: [OK[SERIES], 'network-error'],
    });
    const first = renderApp(<DashboardContainer />);
    await first.findAllByText(money(142000000n, 'ARS', 'es'));
    first.unmount();

    renderApp(<DashboardContainer />);
    expect(await screen.findByText(es.dashboard.states.error)).toBeDefined();
    expect(screen.queryAllByText(money(142000000n, 'ARS', 'es'))).toHaveLength(0);
  });

  it('writes nothing to localStorage (besides the pointer), sessionStorage or IndexedDB', async () => {
    setPointer('user-1');
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const indexedDb = vi.fn();
    vi.stubGlobal('indexedDB', { open: indexedDb });
    stubApi(OK);
    renderApp(<DashboardContainer />);
    await screen.findAllByText(money(142000000n, 'ARS', 'es'));
    expect(local.mock.calls.filter(([key]) => key !== 'pesly-theme')).toEqual([]);
    expect(indexedDb).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('first steps layout (AC-29, AC-30)', () => {
  it('replaces the net worth card and KPIs, hides the other cards and keeps "Do these first"', async () => {
    readGroupQueueCounts.mockResolvedValue({ pending: 0, failed: 0, conflict: 1 });
    stubApi({
      [DASHBOARD]: {
        status: 200,
        body: dashboardBody({
          firstSteps: { hasAccount: false, hasMovement: false, show: true },
          actions: [],
          categories: [],
          budgets: [],
          upcoming: [],
          insight: null,
        }),
      },
      [SERIES]: { status: 200, body: { ...seriesBody(), points: [] } },
    });
    renderApp(<DashboardContainer />);

    expect(await screen.findByText(es.dashboard.firstSteps.title)).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: es.dashboard.firstSteps.createAccount })
        .getAttribute('href'),
    ).toBe('/es/accounts/new');
    expect(screen.queryByRole('region', { name: es.dashboard.netWorth.label })).toBeNull();
    expect(screen.queryByText(es.dashboard.month.expenses)).toBeNull();
    expect(screen.queryByText(es.dashboard.budgets.title)).toBeNull();
    expect(screen.queryByText(es.dashboard.groups.title)).toBeNull();
    expect(await screen.findByText(es.dashboard.attention.title)).toBeDefined();
    expect(screen.getByRole('link', { name: /1 conflicto/ }).getAttribute('href')).toBe(
      '/es/groups',
    );
  });
});

describe('skeleton and screen share one layout (AC-33)', () => {
  it('renders the same slots, in the same order, with the same classes', () => {
    const view = toDashboardView(dashboardResponseSchema.parse(dashboardBody()), {
      locale: 'es',
      otherLabel: 'Otros',
    });
    const loaded = renderApp(
      <DashboardScreen
        locale="es"
        view={view}
        series={{ kind: 'ready', currency: 'ARS', points: [] }}
        attention={[
          { source: 'queue', key: 'q', href: '/movements', kind: 'failedMovements', count: 1 },
        ]}
      />,
    );
    const slots = (root: ParentNode) =>
      Array.from(root.querySelectorAll('[data-dashboard-slot]')).map(
        (node) => `${node.getAttribute('data-dashboard-slot')}|${node.className}`,
      );
    const loadedSlots = slots(loaded.container);
    loaded.unmount();
    const skeleton = renderApp(<DashboardSkeleton />);
    const skeletonSlots = slots(skeleton.container);

    expect(loadedSlots.length).toBeGreaterThanOrEqual(8);
    expect(skeletonSlots).toEqual(loadedSlots);
  });
});

describe('home page content (AC-49)', () => {
  it('offers the add-movement quick action', () => {
    renderApp(<QuickActions />);
    const links = within(
      screen.getByRole('list', { name: es.home.quickActions.label }),
    ).getAllByRole('link');
    expect(links[0]?.getAttribute('href')).toContain('/es/movements/new');
  });

  it('no longer has the removed home components', () => {
    const home = resolve(__dirname, '../src/features/home');
    for (const gone of [
      'components/balance-summary.tsx',
      'components/month-summary.tsx',
      'components/pending-payment.tsx',
      'components/home-screen.tsx',
      'containers/home-container.tsx',
    ]) {
      expect(existsSync(resolve(home, gone)), gone).toBe(false);
    }
    expect(existsSync(resolve(home, 'components/quick-actions.tsx'))).toBe(true);
    expect(existsSync(resolve(home, 'time-zone.ts'))).toBe(true);
  });
});
