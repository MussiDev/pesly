// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMoney } from '@pesly/shared';
import { HomeContainer } from '../src/features/home/containers/home-container';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

/** The DOM matcher normalizes whitespace (non-breaking spaces included), so the needle must be too. */
function money(value: bigint, currency: string, locale: string): string {
  return formatMoney(value, currency, locale).replace(/\s+/g, ' ');
}

const ACCOUNTS_PATH = '/accounts?archived=false&limit=100';
const MOVEMENTS_PATH = '/movements?limit=5';
const CATEGORIES_PATH = '/categories?archived=false&limit=100';
const PROFILE_PATH = '/profile';
const ARCHIVED_ACCOUNTS_PATH = '/accounts?archived=true&limit=100';
const ARCHIVED_CATEGORIES_PATH = '/categories?archived=true&limit=100';

function account(id: string, name: string, currency: 'ARS' | 'USD') {
  return {
    id,
    name,
    type: 'cash',
    currency,
    openingBalance: '0',
    balance: '0',
    includeInAvailable: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function accountsBody(items: ReturnType<typeof account>[], archivedList = false) {
  return {
    items,
    availableTotals:
      items.length === 0 || archivedList
        ? { ARS: '0', USD: '0' }
        : { ARS: '1234500', USD: '25000' },
    netWorthTotals:
      items.length === 0 || archivedList
        ? { ARS: '0', USD: '0' }
        : { ARS: '1334500', USD: '30000' },
    debtTotals: { ARS: '0', USD: '0' },
    creditCardCount: 0,
    total: items.length,
    limit: 100,
    offset: 0,
  };
}

function movement(n: number, type: 'expense' | 'income' = 'expense', accountId = 'a1') {
  return {
    id: `m${String(n)}`,
    type,
    accountId,
    categoryId: 'c1',
    amount: String(n * 100),
    occurredAt: `2026-10-0${String(n)}T12:00:00.000Z`,
    note: `Note ${String(n)}`,
    rate: '10000',
    rateSource: 'automatic',
    rateType: null,
    createdAt: `2026-10-0${String(n)}T12:00:00.000Z`,
  };
}

const FOOD = {
  id: 'c1',
  kind: 'expense',
  parentId: null,
  key: 'food',
  name: null,
  icon: 'utensils',
  color: 'orange',
  archived: false,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const EMPTY_CATEGORIES = { status: 200, body: { items: [], total: 0, limit: 100, offset: 0 } };

function loadedRoutes() {
  return {
    [`GET ${ACCOUNTS_PATH}`]: {
      status: 200,
      body: accountsBody([account('a1', 'Caja', 'ARS'), account('a2', 'Dólares', 'USD')]),
    },
    [`GET ${ARCHIVED_ACCOUNTS_PATH}`]: {
      status: 200,
      body: accountsBody([{ ...account('a3', 'Vieja', 'USD'), archived: true }], true),
    },
    [`GET ${MOVEMENTS_PATH}`]: {
      status: 200,
      body: {
        items: [5, 4, 3, 2, 1].map((n) => movement(n)),
        total: 9,
        limit: 5,
        offset: 0,
      },
    },
    [`GET ${CATEGORIES_PATH}`]: {
      status: 200,
      body: { items: [FOOD], total: 1, limit: 100, offset: 0 },
    },
    [`GET ${ARCHIVED_CATEGORIES_PATH}`]: EMPTY_CATEGORIES,
  };
}

function profileAnswer(timeZone: string) {
  return {
    status: 200,
    body: {
      displayName: 'Ana',
      email: 'ana@example.com',
      twoFactorEnabled: false,
      deletionReauth: 'password',
      preferences: { defaultRateType: 'blue', displayCurrency: 'ARS', timeZone, language: 'es' },
    },
  };
}

/** The late-evening UTC instant that is already the next day in Tokyo. */
const LATE_UTC = '2026-10-05T23:30:00.000Z';

/** Still the previous day in Buenos Aires, so a Buenos Aires fallback cannot pass for UTC. */
const EARLY_UTC = '2026-10-05T01:30:00.000Z';

function lateMovementRoutes(overrides: Record<string, unknown> = {}, instant = LATE_UTC) {
  const routes = loadedRoutes();
  return {
    ...routes,
    [`GET ${MOVEMENTS_PATH}`]: {
      status: 200,
      body: {
        items: [{ ...movement(5), occurredAt: instant }],
        total: 1,
        limit: 5,
        offset: 0,
      },
    },
    ...overrides,
  };
}

function dayIn(timeZone: string, instant = LATE_UTC): string {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone }).format(new Date(instant));
}

function pretendBrowserZoneIs(timeZone: string) {
  const base = new Intl.DateTimeFormat('es').resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => ({
    ...base,
    timeZone,
  }));
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HomeContainer', () => {
  it('shows the balance per currency and the five latest movements (AC-18)', async () => {
    stubApi(loadedRoutes());
    renderApp(<HomeContainer />);

    const ars = await screen.findByRole('group', { name: es.home.balance.currencies.ARS });
    expect(within(ars).getByText(money(1234500n, 'ARS', 'es'))).toBeDefined();
    const usd = screen.getByRole('group', { name: es.home.balance.currencies.USD });
    expect(within(usd).getByText(money(25000n, 'USD', 'es'))).toBeDefined();

    const list = screen.getByRole('list', { name: es.home.recent.title });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    // Newest first, exactly as the API returned them.
    expect(within(rows[0] as HTMLElement).getByText('Note 5')).toBeDefined();
    expect(within(rows[4] as HTMLElement).getByText('Note 1')).toBeDefined();
    expect(within(rows[0] as HTMLElement).getByText(/Comida/)).toBeDefined();
    expect(within(rows[0] as HTMLElement).getByText(/Caja/)).toBeDefined();

    const seeAll = screen.getByRole('link', { name: es.home.recent.seeAll });
    expect(seeAll.getAttribute('href')).toBe('/es/movements');
    expect(
      screen.getByRole('link', { name: es.home.quickActions.addMovement }).getAttribute('href'),
    ).toBe('/es/movements/new');
    expect(
      screen.getByRole('link', { name: es.home.quickActions.addAccount }).getAttribute('href'),
    ).toBe('/es/accounts/new');
  });

  it('asks the API for the five latest movements only', async () => {
    const { calls } = stubApi(loadedRoutes());
    renderApp(<HomeContainer />);
    await screen.findByRole('list', { name: es.home.recent.title });
    expect(calls.map((call) => call.path)).toContain(MOVEMENTS_PATH);
  });

  it('shows an empty state with a create-account action when there are no accounts (AC-19)', async () => {
    stubApi({
      ...loadedRoutes(),
      [`GET ${ACCOUNTS_PATH}`]: { status: 200, body: accountsBody([]) },
      [`GET ${MOVEMENTS_PATH}`]: {
        status: 200,
        body: { items: [], total: 0, limit: 5, offset: 0 },
      },
    });
    renderApp(<HomeContainer />);

    expect(await screen.findByRole('heading', { name: es.home.empty.title })).toBeDefined();
    const action = screen.getByRole('link', { name: es.home.empty.action });
    expect(action.getAttribute('href')).toBe('/es/accounts/new');
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.ARS })).toBeNull();
    expect(screen.queryByText(money(0n, 'ARS', 'es'))).toBeNull();
  });

  it('shows the balance and an empty movements section when there are accounts but no movements', async () => {
    stubApi({
      ...loadedRoutes(),
      [`GET ${MOVEMENTS_PATH}`]: {
        status: 200,
        body: { items: [], total: 0, limit: 5, offset: 0 },
      },
    });
    renderApp(<HomeContainer />);

    expect(
      await screen.findByRole('group', { name: es.home.balance.currencies.ARS }),
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: es.home.recent.empty.title })).toBeDefined();
    expect(
      screen.getByRole('link', { name: es.home.recent.empty.action }).getAttribute('href'),
    ).toBe('/es/movements/new');
  });

  it('shows the error state, no balance, and recovers with retry when accounts fail (AC-20)', async () => {
    const routes = loadedRoutes();
    stubApi({
      ...routes,
      [`GET ${ACCOUNTS_PATH}`]: [{ status: 500 }, routes[`GET ${ACCOUNTS_PATH}`]],
    });
    renderApp(<HomeContainer />);

    expect(await screen.findByText(es.ui.error.title)).toBeDefined();
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.ARS })).toBeNull();
    expect(screen.queryByRole('list', { name: es.home.recent.title })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: es.ui.retry }));
    expect(
      await screen.findByRole('group', { name: es.home.balance.currencies.ARS }),
    ).toBeDefined();
    expect(screen.queryByText(es.ui.error.title)).toBeNull();
  });

  it('shows the error state and no balance when movements fail, then retry works (AC-20)', async () => {
    const routes = loadedRoutes();
    stubApi({
      ...routes,
      [`GET ${MOVEMENTS_PATH}`]: [{ status: 500 }, routes[`GET ${MOVEMENTS_PATH}`]],
    });
    renderApp(<HomeContainer />);

    expect(await screen.findByText(es.ui.error.title)).toBeDefined();
    // The accounts request succeeded, yet no stale balance may show next to the error.
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.ARS })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: es.ui.retry }));
    expect(await screen.findByRole('list', { name: es.home.recent.title })).toBeDefined();
  });

  it('shows a skeleton from the first render and starts all six requests before any resolves (AC-21, NFR-06)', async () => {
    const { calls, pending } = controlledApi();
    renderApp(<HomeContainer />);

    expect(screen.getByRole('status', { name: es.ui.loading })).toBeDefined();
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.ARS })).toBeNull();
    // Every data request is issued while every one is still unanswered: none waits for another.
    expect([...calls].sort()).toEqual(
      [
        ACCOUNTS_PATH,
        ARCHIVED_ACCOUNTS_PATH,
        MOVEMENTS_PATH,
        CATEGORIES_PATH,
        ARCHIVED_CATEGORIES_PATH,
        PROFILE_PATH,
      ].sort(),
    );
    expect(pending).toHaveLength(6);

    for (const request of pending) request.release(500);
    expect(await screen.findByText(es.ui.error.title)).toBeDefined();
  });

  it('redirects to /sign-in when the session is unauthenticated', async () => {
    stubApi({
      ...loadedRoutes(),
      [`GET ${ACCOUNTS_PATH}`]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<HomeContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.ARS })).toBeNull();
  });

  it('disables retry while a request is in flight so repeated clicks send one request', async () => {
    const { calls, pending } = controlledApi();
    renderApp(<HomeContainer />);
    for (const request of pending.splice(0)) request.release(500);
    const retry = await screen.findByRole('button', { name: es.ui.retry });
    const before = calls.length;

    fireEvent.click(retry);
    const inFlight = await screen.findByRole('button', { name: es.ui.retry });
    expect((inFlight as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(inFlight);
    fireEvent.click(inFlight);

    await waitFor(() => {
      expect(calls.filter((path) => path === ACCOUNTS_PATH)).toHaveLength(2);
    });
    expect(calls.slice(before).filter((path) => path === ACCOUNTS_PATH)).toHaveLength(1);
    expect(calls.slice(before).filter((path) => path === MOVEMENTS_PATH)).toHaveLength(1);

    for (const request of pending.splice(0)) request.release(500);
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: es.ui.retry }).disabled).toBe(
        false,
      );
    });
  });

  it('writes nothing to localStorage, sessionStorage or IndexedDB', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const indexedDb = vi.fn();
    vi.stubGlobal('indexedDB', { open: indexedDb });
    stubApi(loadedRoutes());
    renderApp(<HomeContainer />);
    await screen.findByRole('list', { name: es.home.recent.title });

    expect(local.mock.calls.filter(([key]) => key !== 'pesly-theme')).toEqual([]);
    expect(indexedDb).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
    expect(Object.keys(window.localStorage).filter((key) => key !== 'pesly-theme')).toEqual([]);
  });
  it('renders dates in the profile time zone when the profile loads', async () => {
    pretendBrowserZoneIs('Asia/Tokyo');
    stubApi(lateMovementRoutes({ [`GET ${PROFILE_PATH}`]: profileAnswer('UTC') }));
    renderApp(<HomeContainer />);
    const row = within(await screen.findByRole('list', { name: es.home.recent.title }));
    expect(row.getByText(dayIn('UTC'))).toBeDefined();
    expect(dayIn('UTC')).not.toBe(dayIn('Asia/Tokyo'));
  });

  it('falls back to the browser time zone when the profile request fails', async () => {
    pretendBrowserZoneIs('Asia/Tokyo');
    stubApi(lateMovementRoutes({ [`GET ${PROFILE_PATH}`]: { status: 500 } }));
    renderApp(<HomeContainer />);
    const row = within(await screen.findByRole('list', { name: es.home.recent.title }));
    expect(row.getByText(dayIn('Asia/Tokyo'))).toBeDefined();
  });

  it('falls back to UTC when the profile fails and the browser zone is invalid', async () => {
    pretendBrowserZoneIs('Not/AZone');
    stubApi(lateMovementRoutes({ [`GET ${PROFILE_PATH}`]: { status: 500 } }, EARLY_UTC));
    renderApp(<HomeContainer />);
    const row = within(await screen.findByRole('list', { name: es.home.recent.title }));
    expect(row.getByText(dayIn('UTC', EARLY_UTC))).toBeDefined();
    expect(dayIn('UTC', EARLY_UTC)).not.toBe(dayIn('America/Argentina/Buenos_Aires', EARLY_UTC));
  });

  it('shows the unknown-category placeholder, not an error screen, when categories fail', async () => {
    stubApi({
      ...loadedRoutes(),
      [`GET ${CATEGORIES_PATH}`]: { status: 500 },
      [`GET ${ARCHIVED_CATEGORIES_PATH}`]: { status: 500 },
    });
    renderApp(<HomeContainer />);
    const list = within(await screen.findByRole('list', { name: es.home.recent.title }));
    expect(list.getAllByText(/Categoría desconocida/).length).toBeGreaterThan(0);
    expect(screen.queryByText(es.ui.error.title)).toBeNull();
    expect(screen.getByRole('group', { name: es.home.balance.currencies.ARS })).toBeDefined();
  });

  it('shows an unknown account label and a figure without a currency symbol', async () => {
    const routes = loadedRoutes();
    stubApi({
      ...routes,
      [`GET ${MOVEMENTS_PATH}`]: {
        status: 200,
        body: {
          items: [movement(5, 'expense', 'archived-account')],
          total: 1,
          limit: 5,
          offset: 0,
        },
      },
    });
    renderApp(<HomeContainer />);
    const row = within(await screen.findByRole('listitem'));
    expect(row.getByText(new RegExp(es.home.recent.unknownAccount))).toBeDefined();
    expect(row.getByText('5,00')).toBeDefined();
    expect(row.queryByText(/¤|ARS|USD|\$/)).toBeNull();
  });
  it('shows the real name and currency of a movement on an archived account (AC-18)', async () => {
    stubApi({
      ...loadedRoutes(),
      [`GET ${MOVEMENTS_PATH}`]: {
        status: 200,
        body: { items: [movement(5, 'expense', 'a3')], total: 1, limit: 5, offset: 0 },
      },
    });
    renderApp(<HomeContainer />);
    const row = within(await screen.findByRole('listitem'));
    expect(row.getByText(/Vieja/)).toBeDefined();
    expect(row.getByText(money(500n, 'USD', 'es'))).toBeDefined();
    expect(row.queryByText(new RegExp(es.home.recent.unknownAccount))).toBeNull();
  });

  it('shows the unknown-account label and no currency symbol when the archived accounts fail', async () => {
    stubApi({
      ...loadedRoutes(),
      [`GET ${ARCHIVED_ACCOUNTS_PATH}`]: { status: 500 },
      [`GET ${MOVEMENTS_PATH}`]: {
        status: 200,
        body: { items: [movement(5, 'expense', 'a3')], total: 1, limit: 5, offset: 0 },
      },
    });
    renderApp(<HomeContainer />);
    const row = within(await screen.findByRole('listitem'));
    expect(row.getByText(new RegExp(es.home.recent.unknownAccount))).toBeDefined();
    expect(row.getByText('5,00')).toBeDefined();
    expect(row.queryByText(/¤|ARS|USD|\$/)).toBeNull();
    expect(screen.queryByText(es.ui.error.title)).toBeNull();
    expect(screen.getByRole('group', { name: es.home.balance.currencies.ARS })).toBeDefined();
  });

  it.each([
    ['archived accounts', ARCHIVED_ACCOUNTS_PATH],
    ['active categories', CATEGORIES_PATH],
    ['archived categories', ARCHIVED_CATEGORIES_PATH],
    ['profile', PROFILE_PATH],
  ])('redirects to /sign-in when the %s request is unauthenticated', async (_name, path) => {
    stubApi({
      ...loadedRoutes(),
      [`GET ${path}`]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<HomeContainer />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.ARS })).toBeNull();
  });

  it('shows the error state, not a crash, when the API sends a malformed total', async () => {
    const routes = loadedRoutes();
    stubApi({
      ...routes,
      [`GET ${ACCOUNTS_PATH}`]: {
        status: 200,
        body: {
          ...accountsBody([account('a1', 'Caja', 'ARS')]),
          availableTotals: { ARS: '12.5' },
          netWorthTotals: { ARS: '1000' },
        },
      },
    });
    renderApp(<HomeContainer />);
    // The API client's schemas reject the value first; the component-level placeholder is the
    // second line of defence and is covered in home-components.test.tsx.
    expect(await screen.findByText(es.ui.error.title)).toBeDefined();
    expect(screen.queryByRole('group', { name: es.home.balance.currencies.ARS })).toBeNull();
  });
});
