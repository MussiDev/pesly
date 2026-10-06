// @vitest-environment happy-dom
import {
  formatMoney,
  type AccountResponse,
  type CategoryResponse,
  type MovementResponse,
} from '@pesly/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovementsContainer } from '../src/features/movements/containers/movements-container';
import { formatRate } from '../src/features/movements/format-rate';
import { enqueueMovement, markRejected, type QueuedRequest } from '../src/lib/local-store/queue';
import { loadRecentMovements, saveReferenceData } from '../src/lib/local-store/reference-cache';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { openLocalStore, type LocalStore } from '../src/lib/local-store/stores';
import { CATALOGS, renderApp, stubApi } from './support/render-app';
import { category as categoryFixture, uuid } from './support/category-fixtures';

const { es, en } = CATALOGS;

const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const PROFILE = 'GET /profile';
const ACTIVE_ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const ARCHIVED_ACCOUNTS = 'GET /accounts?archived=true&limit=100';
const ACTIVE_CATEGORIES = 'GET /categories?archived=false&limit=100';
const ARCHIVED_CATEGORIES = 'GET /categories?archived=true&limit=100';
const FIRST_PAGE = 'GET /movements?limit=100';
const SECOND_PAGE = 'GET /movements?limit=100&offset=100';

const CAJA_ID = uuid(1);
const DOLARES_ID = uuid(2);
const COMIDA_ID = uuid(11);
const VIEJA_ID = uuid(12);

function account(overrides: Partial<AccountResponse> = {}): AccountResponse {
  return {
    id: CAJA_ID,
    name: 'Caja',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '0',
    balance: '0',
    includeInAvailable: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function accountPage(items: AccountResponse[]) {
  return {
    status: 200,
    body: {
      items,
      availableTotals: { ARS: '0', USD: '0' },
      netWorthTotals: { ARS: '0', USD: '0' },
      debtTotals: { ARS: '0', USD: '0' },
      creditCardCount: 0,
      total: items.length,
      limit: 100,
      offset: 0,
    },
  };
}

function categoryPage(items: CategoryResponse[]) {
  return { status: 200, body: { items, total: items.length, limit: 100, offset: 0 } };
}

function movement(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(500),
    type: 'expense',
    accountId: CAJA_ID,
    categoryId: COMIDA_ID,
    destinationAccountId: null,
    amount: '150050',
    destinationAmount: null,
    occurredAt: '2026-10-02T15:30:00.000Z',
    note: null,
    rate: '12505000',
    rateSource: 'automatic',
    rateType: 'blue',
    createdAt: '2026-10-02T15:31:00.000Z',
    tags: [],
    ...overrides,
  };
}

function movementPage(items: unknown[], total = items.length, offset = 0) {
  return { status: 200, body: { items, total, limit: 100, offset } };
}

const ARCHIVED_ACCOUNT = account({
  id: DOLARES_ID,
  name: 'Dolares viejos',
  currency: 'USD',
  archived: true,
  archivedAt: '2026-10-01T10:00:00.000Z',
});

function routes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return {
    [PROFILE]: {
      status: 200,
      body: {
        displayName: 'Ana',
        email: 'ana@example.com',
        twoFactorEnabled: false,
        deletionReauth: 'password',
        preferences: {
          defaultRateType: 'blue',
          displayCurrency: 'ARS',
          timeZone: TIME_ZONE,
          language: 'es',
        },
      },
    },
    [ACTIVE_ACCOUNTS]: accountPage([account()]),
    [ARCHIVED_ACCOUNTS]: accountPage([ARCHIVED_ACCOUNT]),
    [ACTIVE_CATEGORIES]: categoryPage([
      categoryFixture({ id: COMIDA_ID, kind: 'expense', name: 'Comida', icon: 'utensils' }),
    ]),
    [ARCHIVED_CATEGORIES]: categoryPage([
      categoryFixture({
        id: VIEJA_ID,
        kind: 'income',
        name: 'Vieja',
        icon: 'utensils',
        archived: true,
        archivedAt: '2026-10-01T10:00:00.000Z',
      }),
    ]),
    [FIRST_PAGE]: movementPage([]),
    ...overrides,
  };
}

/** Testing Library normalizes the no-break spaces Intl emits in the rendered text. */
const plain = (text: string) => text.replace(/\s+/g, ' ');

const rows = () => screen.getAllByRole('listitem');

/** The Amount of a row: its direction and its text (sign, direction label for screen readers, figure). */
function amountOf(row: HTMLElement) {
  const amount = row.querySelector('[data-slot="amount"]');
  if (amount === null) throw new Error('Expected an Amount in the row');
  return { kind: amount.getAttribute('data-kind'), text: plain(amount.textContent) };
}

const rateLine = (rate: bigint, locale: 'es' | 'en') =>
  (locale === 'es' ? es : en).movements.list.rate.replace('{rate}', formatRate(rate, locale));

describe('MovementsContainer', () => {
  it('lists movements newest first with names, amounts and currencies, the frozen rate only on the USD row, including archived ones (AC-01, AC-04, AC-14)', async () => {
    const newest = movement({ id: uuid(502), note: 'Almuerzo' });
    const older = movement({
      id: uuid(501),
      type: 'income',
      accountId: DOLARES_ID,
      categoryId: VIEJA_ID,
      amount: '20000',
      occurredAt: '2026-10-01T02:00:00.000Z',
      rate: '9000000',
    });
    const { calls } = stubApi(routes({ [FIRST_PAGE]: movementPage([newest, older]) }));
    renderApp(<MovementsContainer />);

    await screen.findByText('Almuerzo');
    const [first, second] = rows();
    if (first === undefined || second === undefined) throw new Error('Expected two rows');

    expect(within(first).getByText('Comida')).toBeDefined();
    expect(within(first).getByText('Caja')).toBeDefined();
    expect(amountOf(first)).toEqual({
      kind: 'expense',
      text: `−${es.movements.types.expense}${plain(formatMoney(150050n, 'ARS', 'es'))}`,
    });
    // An ARS-account row hides the frozen rate: it stays stored, the list does not show it.
    expect(within(first).queryByText(rateLine(12505000n, 'es'))).toBeNull();
    expect(within(first).queryByText(/Cotizaci/)).toBeNull();
    expect(within(first).getByText(/12:30/)).toBeDefined();
    expect(within(first).queryByText(/15:30/)).toBeNull();

    // The archived account and category still name the movement; income is signed positive.
    expect(within(second).getByText('Vieja')).toBeDefined();
    expect(within(second).getByText('Dolares viejos')).toBeDefined();
    expect(amountOf(second)).toEqual({
      kind: 'income',
      text: `+${es.movements.types.income}${plain(formatMoney(20000n, 'USD', 'es'))}`,
    });
    // A USD-account row shows the rate that was frozen on the movement.
    expect(within(second).getByText(rateLine(9000000n, 'es'))).toBeDefined();
    // 02:00 UTC is still the previous day in Buenos Aires (23:00).
    expect(within(second).getByText(/23:00/)).toBeDefined();

    expect(calls.map((call) => call.path)).toEqual(
      expect.arrayContaining([
        '/movements?limit=100',
        '/accounts?archived=false&limit=100',
        '/accounts?archived=true&limit=100',
        '/categories?archived=false&limit=100',
        '/categories?archived=true&limit=100',
      ]),
    );
  });

  it('formats in the active locale', async () => {
    const usd = movement({ id: uuid(503), accountId: DOLARES_ID, categoryId: VIEJA_ID });
    stubApi(routes({ [FIRST_PAGE]: movementPage([movement(), usd]) }));
    renderApp(<MovementsContainer />, { locale: 'en' });

    await screen.findAllByRole('listitem');
    const [ars] = rows();
    if (ars === undefined) throw new Error('Expected a row');
    expect(amountOf(ars)).toEqual({
      kind: 'expense',
      text: `−${en.movements.types.expense}${plain(formatMoney(150050n, 'ARS', 'en'))}`,
    });
    // Only the USD row carries the rate line, in the English wording.
    expect(
      screen.getAllByText(en.movements.list.rate.replace('{rate}', formatRate(12505000n, 'en'))),
    ).toHaveLength(1);
  });

  it('shows the empty state with a link to the entry screen', async () => {
    stubApi(routes());
    renderApp(<MovementsContainer />);

    expect(await screen.findByText(es.movements.list.empty)).toBeDefined();
    const link = screen.getByRole('link', { name: es.movements.list.newMovement });
    expect(link.getAttribute('href')).toBe('/es/movements/new');
  });

  it('"show more" loads the next page of at most 100 and stops when the total is reached (AC-14)', async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        movement({ id: uuid(1000 + start + index), note: `Nota ${start + index}` }),
      );
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: movementPage(page(0, 100), 150),
        [SECOND_PAGE]: movementPage(page(100, 50), 150, 100),
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByText('Nota 0')).toBeDefined();
    expect(rows()).toHaveLength(100);
    await user.click(screen.getByRole('button', { name: es.movements.list.showMore }));

    expect(await screen.findByText('Nota 149')).toBeDefined();
    expect(rows()).toHaveLength(150);
    expect(screen.queryByRole('button', { name: es.movements.list.showMore })).toBeNull();
    expect(
      calls.filter((call) => call.path.startsWith('/movements')).map((call) => call.path),
    ).toEqual(['/movements?limit=100', '/movements?limit=100&offset=100']);
  });

  it('sends the user to sign-in when the session is gone (error path)', async () => {
    stubApi(routes({ [FIRST_PAGE]: { status: 401, body: { code: 'UNAUTHENTICATED' } } }));
    const { router } = renderApp(<MovementsContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('shows the generic message with a retry when the first load fails (error path)', async () => {
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: [{ status: 500 }, movementPage([movement({ note: 'Almuerzo' })])],
      }),
    );
    renderApp(<MovementsContainer />);

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByText('Almuerzo')).toBeDefined();
    expect(screen.queryByText(es.errors.unexpected)).toBeNull();
    expect(calls.filter((call) => call.path === '/movements?limit=100')).toHaveLength(2);
  });

  it('keeps the rows and shows the generic message with a retry when "show more" fails (error path)', async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        movement({ id: uuid(2000 + start + index), note: `Nota ${start + index}` }),
      );
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage(page(0, 100), 101),
        [SECOND_PAGE]: [{ status: 500 }, movementPage(page(100, 1), 101, 100)],
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText('Nota 0');
    await user.click(screen.getByRole('button', { name: es.movements.list.showMore }));

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    expect(rows()).toHaveLength(100);
    await user.click(screen.getByRole('button', { name: es.movements.list.showMore }));

    expect(await screen.findByText('Nota 100')).toBeDefined();
    expect(rows()).toHaveLength(101);
    expect(screen.queryByText(es.errors.unexpected)).toBeNull();
  });

  it('shows placeholders for an unknown account or category and does not fail (error path)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage([
          movement({ accountId: uuid(77), categoryId: uuid(78), note: 'Huérfano' }),
        ]),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText('Huérfano');
    const [row] = rows();
    if (row === undefined) throw new Error('Expected a row');
    expect(within(row).getByText(es.movements.list.unknownAccount)).toBeDefined();
    expect(within(row).getByText(es.movements.list.unknownCategory)).toBeDefined();
    expect(within(row).getByText(/1500,50/)).toBeDefined();
  });

  it('does not repeat a row when a movement created between pages shifts the offset', async () => {
    const all = Array.from({ length: 101 }, (_, index) =>
      movement({ id: uuid(3000 + index), note: `Nota ${index}` }),
    );
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage(all.slice(0, 100), 101),
        // The boundary row (index 99) comes again because a new movement pushed it down.
        [SECOND_PAGE]: movementPage(all.slice(99), 101, 100),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText('Nota 0');
    await userEvent.setup().click(screen.getByRole('button', { name: es.movements.list.showMore }));

    expect(await screen.findByText('Nota 100')).toBeDefined();
    expect(rows()).toHaveLength(101);
    expect(screen.getAllByText('Nota 99')).toHaveLength(1);
  });

  it('sends the user to sign-in when the session is gone during "show more" (error path)', async () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      movement({ id: uuid(4000 + index), note: `Nota ${index}` }),
    );
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage(page, 101),
        [SECOND_PAGE]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      }),
    );
    const { router } = renderApp(<MovementsContainer />);

    await screen.findByText('Nota 0');
    await userEvent.setup().click(screen.getByRole('button', { name: es.movements.list.showMore }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(rows()).toHaveLength(100);
  });

  it('reads exactly six requests on load, one per list (no N+1)', async () => {
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: movementPage(
          Array.from({ length: 5 }, (_, index) =>
            movement({ id: uuid(5000 + index), note: `Nota ${index}` }),
          ),
        ),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText('Nota 4');
    expect(calls).toHaveLength(6);
  });

  it('pages accounts and categories beyond 100 until the total is reached', async () => {
    const accounts = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        account({ id: uuid(6000 + from + index), name: `Cuenta ${from + index}` }),
      );
    const categories = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        categoryFixture({
          id: uuid(7000 + from + index),
          name: `Rubro ${from + index}`,
          icon: 'utensils',
        }),
      );
    const accountsPage = (items: AccountResponse[], total: number, offset: number) => ({
      status: 200,
      body: { ...accountPage(items).body, total, offset },
    });
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: movementPage([
          movement({ accountId: uuid(6000 + 149), categoryId: uuid(7000 + 120), note: 'Lejano' }),
        ]),
        [ACTIVE_ACCOUNTS]: accountsPage(accounts(0, 100), 150, 0),
        [`${ACTIVE_ACCOUNTS}&offset=100`]: accountsPage(accounts(100, 50), 150, 100),
        // The stale total promises more, but the next page is empty: the loop must stop.
        [ACTIVE_CATEGORIES]: {
          status: 200,
          body: { items: categories(0, 100), total: 130, limit: 100, offset: 0 },
        },
        [`${ACTIVE_CATEGORIES}&offset=100`]: {
          status: 200,
          body: { items: categories(100, 21), total: 130, limit: 100, offset: 100 },
        },
        [`${ACTIVE_CATEGORIES}&offset=121`]: {
          status: 200,
          body: { items: [], total: 130, limit: 100, offset: 121 },
        },
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText('Lejano');
    const [row] = rows();
    if (row === undefined) throw new Error('Expected a row');
    expect(within(row).getByText('Cuenta 149')).toBeDefined();
    expect(within(row).getByText('Rubro 120')).toBeDefined();
    const paths = calls.map((call) => call.path);
    expect(paths).toContain('/accounts?archived=false&limit=100&offset=100');
    expect(paths).toContain('/categories?archived=false&limit=100&offset=121');
    expect(paths).not.toContain('/categories?archived=false&limit=100&offset=221');
  });

  it('falls back to the default zone when the profile zone is invalid (error path)', async () => {
    const base = routes();
    const profile = base[PROFILE];
    stubApi({
      ...base,
      [PROFILE]: {
        status: 200,
        body: {
          ...profile.body,
          preferences: { ...profile.body.preferences, timeZone: 'Not/AZone' },
        },
      },
      [FIRST_PAGE]: movementPage([movement({ note: 'Almuerzo' })]),
    });
    renderApp(<MovementsContainer />);

    await screen.findByText('Almuerzo');
    const [row] = rows();
    if (row === undefined) throw new Error('Expected a row');
    // 15:30 UTC in the default zone (Buenos Aires, UTC-3).
    expect(within(row).getByText(/12:30/)).toBeDefined();
  });

  it('marks the list as a list and the show-more button busy while loading', async () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      movement({ id: uuid(8000 + index), note: `Nota ${index}` }),
    );
    stubApi(routes({ [FIRST_PAGE]: movementPage(page, 101) }));
    renderApp(<MovementsContainer />);

    await screen.findByText('Nota 0');
    expect(screen.getByRole('list').tagName).toBe('UL');
    expect(screen.getByRole('list').getAttribute('role')).toBe('list');
    const button = screen.getByRole('button', { name: es.movements.list.showMore });
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  describe('transfers and exchanges (03c)', () => {
    const AHORRO_ID = uuid(3);
    const MEP_ID = uuid(4);
    const transfer = (overrides: Record<string, unknown> = {}) =>
      movement({
        id: uuid(601),
        type: 'transfer',
        categoryId: null,
        destinationAccountId: AHORRO_ID,
        amount: '500000',
        destinationAmount: '500000',
        rate: null,
        rateSource: null,
        rateType: null,
        occurredAt: '2026-10-02T15:30:00.000Z',
        ...overrides,
      });
    const exchange = (overrides: Record<string, unknown> = {}) =>
      movement({
        id: uuid(602),
        type: 'exchange',
        categoryId: null,
        destinationAccountId: MEP_ID,
        amount: '1250000',
        destinationAmount: '1000',
        rate: '125000000',
        rateSource: 'implied',
        rateType: null,
        occurredAt: '2026-10-03T15:30:00.000Z',
        ...overrides,
      });
    const withAccounts = (items: unknown[]) =>
      routes({
        [ACTIVE_ACCOUNTS]: accountPage([
          account(),
          account({ id: AHORRO_ID, name: 'Ahorro' }),
          account({ id: MEP_ID, name: 'Dolar MEP', currency: 'USD' }),
        ]),
        [FIRST_PAGE]: movementPage(items),
      });

    it('lists a transfer and an exchange newest first among expenses and income with both account names and currencies (AC-08)', async () => {
      const expense = movement({ id: uuid(603), occurredAt: '2026-10-01T15:30:00.000Z' });
      stubApi(withAccounts([exchange(), transfer(), expense]));
      renderApp(<MovementsContainer />);

      await screen.findByText(es.movements.list.exchangeTitle, { selector: 'div' });
      const [first, second, third] = rows();
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error('Expected three rows');
      }
      expect(within(first).getByText(es.movements.list.exchangeTitle)).toBeDefined();
      expect(within(first).getByText('Caja')).toBeDefined();
      expect(within(first).getByText('Dolar MEP')).toBeDefined();
      expect(within(first).getByText(plain(formatMoney(-1250000n, 'ARS', 'es')))).toBeDefined();
      expect(within(first).getByText(`+${plain(formatMoney(1000n, 'USD', 'es'))}`)).toBeDefined();

      expect(within(second).getByText(es.movements.list.transferTitle)).toBeDefined();
      expect(within(second).getByText('Caja')).toBeDefined();
      expect(within(second).getByText('Ahorro')).toBeDefined();
      expect(within(second).getByText(plain(formatMoney(-500000n, 'ARS', 'es')))).toBeDefined();
      expect(within(second).getByText(/12:30/)).toBeDefined();
      expect(within(second).queryByText(/\+/)).toBeNull();

      expect(within(third).getByText('Comida')).toBeDefined();
    });

    it('an exchange row shows the implied rate with 4 decimals while an ARS expense row hides the rate (AC-05, AC-08)', async () => {
      stubApi(withAccounts([exchange(), movement({ id: uuid(604) })]));
      renderApp(<MovementsContainer />);

      await screen.findByText(es.movements.list.exchangeTitle, { selector: 'div' });
      const [first, second] = rows();
      if (first === undefined || second === undefined) throw new Error('Expected two rows');
      expect(
        within(first).getByText(
          es.movements.list.rate.replace('{rate}', formatRate(12500n * 10000n, 'es', 4)),
        ),
      ).toBeDefined();
      expect(within(second).queryByText(/12\.505/)).toBeNull();
      expect(within(second).queryByText(/Cotizaci|Tipo de cambio/)).toBeNull();
    });

    it('a transfer to an archived destination shows its name (AC-08)', async () => {
      stubApi(
        routes({
          [FIRST_PAGE]: movementPage([transfer({ destinationAccountId: DOLARES_ID })]),
        }),
      );
      renderApp(<MovementsContainer />);

      await screen.findByText(es.movements.list.transferTitle, { selector: 'div' });
      const [row] = rows();
      if (row === undefined) throw new Error('Expected a row');
      expect(within(row).getByText('Dolares viejos')).toBeDefined();
    });

    it('a destination id missing from the loaded sets shows the placeholder and does not fail (error path, AC-08)', async () => {
      stubApi(
        routes({ [FIRST_PAGE]: movementPage([transfer({ destinationAccountId: uuid(99) })]) }),
      );
      renderApp(<MovementsContainer />);

      await screen.findByText(es.movements.list.transferTitle, { selector: 'div' });
      const [row] = rows();
      if (row === undefined) throw new Error('Expected a row');
      expect(within(row).getByText(es.movements.list.unknownAccount)).toBeDefined();
      expect(within(row).getByText('Caja')).toBeDefined();
      expect(screen.queryByText(es.errors.unexpected)).toBeNull();
    });

    it('a 401 redirects to sign in and a server error keeps the transfer rows with the generic message (error path, AC-08)', async () => {
      const page = Array.from({ length: 100 }, (_, index) =>
        transfer({ id: uuid(7000 + index), note: `Nota ${index}` }),
      );
      stubApi(
        withAccountsPaged(page, [
          { status: 500 },
          { status: 401, body: { code: 'UNAUTHENTICATED' } },
        ]),
      );
      const { router } = renderApp(<MovementsContainer />);
      const user = userEvent.setup();

      await screen.findByText('Nota 0');
      await user.click(screen.getByRole('button', { name: es.movements.list.showMore }));
      expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
      expect(rows()).toHaveLength(100);
      await user.click(screen.getByRole('button', { name: es.movements.list.showMore }));
      await waitFor(() => {
        expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
      });
      expect(rows()).toHaveLength(100);
    });

    function withAccountsPaged(page: unknown[], second: Parameters<typeof stubApi>[0][string]) {
      return routes({
        [ACTIVE_ACCOUNTS]: accountPage([account(), account({ id: AHORRO_ID, name: 'Ahorro' })]),
        [FIRST_PAGE]: movementPage(page, 101),
        [SECOND_PAGE]: second,
      });
    }
  });
});

const FIRST_PAGE_PATH = '/movements?limit=100';
const TREE_PARENT_ID = uuid(21);
const TREE_CHILD_ID = uuid(22);
const SIGN_IN = '/es/sign-in';

/** The URL the list asks for with these filters, in the order the API client writes them. */
function listPath(query = '') {
  return `/movements?limit=100${query === '' ? '' : `&${query}`}`;
}

const listCalls = (calls: { method: string; path: string }[]) =>
  calls.filter((call) => call.path.startsWith('/movements')).map((call) => call.path);

const filterField = (name: string) => screen.getByLabelText<HTMLSelectElement>(name);

describe('MovementsContainer filters (DISC-001-03d)', () => {
  const filteredRoutes = (extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}) =>
    routes({
      [ACTIVE_CATEGORIES]: categoryPage([
        categoryFixture({ id: COMIDA_ID, kind: 'expense', name: 'Comida', icon: 'utensils' }),
        categoryFixture({ id: TREE_PARENT_ID, kind: 'expense', name: 'Hogar', icon: 'utensils' }),
        categoryFixture({
          id: TREE_CHILD_ID,
          kind: 'expense',
          parentId: TREE_PARENT_ID,
          name: 'Alquiler',
          icon: 'utensils',
        }),
      ]),
      ...Object.fromEntries(
        Object.entries(extra).map(([key, answer]) => [
          key.startsWith('/') ? `GET ${key}` : key,
          answer,
        ]),
      ),
    });

  it('sends account, category, dates, type and tag together and shows only the returned rows (AC-01)', async () => {
    const full = listPath(
      `accountId=${CAJA_ID}&categoryId=${COMIDA_ID}&from=2026-10-01&to=2026-10-31&type=expense&tag=Viaje`,
    );
    const { calls } = stubApi(
      filteredRoutes({
        [FIRST_PAGE]: movementPage([movement({ id: uuid(601), note: 'Sin filtro' })]),
        [full]: movementPage([movement({ id: uuid(602), note: 'Con filtro' })]),
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText('Sin filtro');
    await user.selectOptions(filterField(es.movements.filters.account), CAJA_ID);
    await user.selectOptions(filterField(es.movements.filters.category), COMIDA_ID);
    fireEvent.change(filterField(es.movements.filters.from), { target: { value: '2026-10-01' } });
    fireEvent.change(filterField(es.movements.filters.to), { target: { value: '2026-10-31' } });
    await user.selectOptions(filterField(es.movements.filters.type), 'expense');
    await user.type(screen.getByLabelText(es.movements.tags.label), 'Viaje{Enter}');

    expect(await screen.findByText('Con filtro')).toBeDefined();
    expect(screen.queryByText('Sin filtro')).toBeNull();
    expect(listCalls(calls).at(-1)).toBe(full);
  });

  it('a parent category is sent once by its id and the subcategory rows that come back are shown (AC-02)', async () => {
    const byParent = listPath(`categoryId=${TREE_PARENT_ID}`);
    const { calls } = stubApi(
      filteredRoutes({
        [byParent]: movementPage([movement({ categoryId: TREE_CHILD_ID, note: 'Julio' })]),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText(es.movements.list.empty);
    const options = within(filterField(es.movements.filters.category)).getAllByRole('option');
    const labels = options.map((option) => option.textContent.trim());
    // A parent is offered as such, with its subcategory right under it.
    expect(labels.indexOf('Alquiler')).toBe(labels.indexOf('Hogar') + 1);
    await userEvent
      .setup()
      .selectOptions(filterField(es.movements.filters.category), TREE_PARENT_ID);

    const row = (await screen.findByText('Julio')).closest('li');
    if (row === null) throw new Error('Expected a row');
    expect(within(row).getByText('Alquiler')).toBeDefined();
    expect(listCalls(calls).filter((path) => path.includes('categoryId'))).toEqual([byParent]);
  });

  it('"show more" keeps the filters and clearing them reloads the unfiltered list (AC-01)', async () => {
    const filtered = listPath(`accountId=${CAJA_ID}`);
    // The client writes the paging keys before the filters.
    const moreFiltered = `/movements?limit=100&offset=100&accountId=${CAJA_ID}`;
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        movement({ id: uuid(9000 + start + index), note: `Fila ${start + index}` }),
      );
    const { calls } = stubApi(
      filteredRoutes({
        [FIRST_PAGE]: movementPage([movement({ note: 'Todo' })]),
        [filtered]: movementPage(page(0, 100), 150),
        [moreFiltered]: movementPage(page(100, 50), 150, 100),
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText('Todo');
    await user.selectOptions(filterField(es.movements.filters.account), CAJA_ID);
    await screen.findByText('Fila 0');
    await user.click(screen.getByRole('button', { name: es.movements.list.showMore }));
    await screen.findByText('Fila 149');
    expect(listCalls(calls).slice(-2)).toEqual([filtered, moreFiltered]);

    await user.click(screen.getByRole('button', { name: es.movements.filters.clear }));

    expect(await screen.findByText('Todo')).toBeDefined();
    expect(listCalls(calls).at(-1)).toBe(FIRST_PAGE_PATH);
    expect(filterField(es.movements.filters.account).value).toBe('');
  });

  it('an empty filtered result shows the no-matches message and a way back, not the empty-history message (AC-07)', async () => {
    stubApi(
      filteredRoutes({
        [FIRST_PAGE]: movementPage([movement({ note: 'Todo' })]),
        [listPath('type=income')]: movementPage([]),
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText('Todo');
    await user.selectOptions(filterField(es.movements.filters.type), 'income');

    expect(await screen.findByText(es.movements.filters.noMatch)).toBeDefined();
    expect(screen.queryByText(es.movements.list.empty)).toBeNull();
    await user.click(screen.getByRole('button', { name: es.movements.filters.showAll }));
    expect(await screen.findByText('Todo')).toBeDefined();
    expect(screen.queryByText(es.movements.filters.noMatch)).toBeNull();
  });

  it('refuses a from after the to and sends no request (invalid input, AC-01)', async () => {
    const { calls } = stubApi(filteredRoutes());
    renderApp(<MovementsContainer />);
    await screen.findByText(es.movements.list.empty);
    const before = listCalls(calls).length;

    fireEvent.change(filterField(es.movements.filters.from), { target: { value: '2026-10-10' } });
    fireEvent.change(filterField(es.movements.filters.to), { target: { value: '2026-10-01' } });

    expect(await screen.findByText(es.movements.filters.invalidRange)).toBeDefined();
    // The first change (from alone) is a valid range and loads; the invalid pair adds nothing.
    expect(listCalls(calls).slice(before)).toEqual([listPath('from=2026-10-10')]);
    expect(listCalls(calls).some((path) => path.includes('to='))).toBe(false);

    fireEvent.change(filterField(es.movements.filters.to), { target: { value: '2026-10-20' } });
    await waitFor(() => {
      expect(screen.queryByText(es.movements.filters.invalidRange)).toBeNull();
    });
    expect(listCalls(calls).at(-1)).toBe(listPath('from=2026-10-10&to=2026-10-20'));
  });

  it('a failed filtered request shows the retry state, keeps the filters and recovers (error path, AC-01)', async () => {
    const filtered = listPath(`accountId=${CAJA_ID}`);
    const { calls } = stubApi(
      filteredRoutes({
        [filtered]: [{ status: 500 }, movementPage([movement({ note: 'Recuperada' })])],
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText(es.movements.list.empty);
    await user.selectOptions(filterField(es.movements.filters.account), CAJA_ID);

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    expect(filterField(es.movements.filters.account).value).toBe(CAJA_ID);
    await user.click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByText('Recuperada')).toBeDefined();
    expect(listCalls(calls).filter((path) => path === filtered)).toHaveLength(2);
    expect(filterField(es.movements.filters.account).value).toBe(CAJA_ID);
  });

  it('discards an answer for older filters that arrives late (error path, AC-01)', async () => {
    const slow = listPath(`accountId=${CAJA_ID}`);
    const fast = listPath(`accountId=${CAJA_ID}&type=income`);
    stubApi(
      filteredRoutes({
        [slow]: movementPage([movement({ id: uuid(701), note: 'Vieja respuesta' })]),
        [fast]: movementPage([movement({ id: uuid(702), note: 'Respuesta nueva' })]),
      }),
    );
    // Hold the first filtered answer until the second one has been shown.
    const real = globalThis.fetch;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.endsWith(slow) ? gate.then(() => real(url, init)) : real(url, init),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText(es.movements.list.empty);
    await user.selectOptions(filterField(es.movements.filters.account), CAJA_ID);
    await user.selectOptions(filterField(es.movements.filters.type), 'income');
    expect(await screen.findByText('Respuesta nueva')).toBeDefined();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText('Vieja respuesta')).toBeNull();
    expect(screen.getByText('Respuesta nueva')).toBeDefined();
  });

  it('sends the user to sign-in when a filtered request says the session is gone (error path, AC-07)', async () => {
    stubApi(
      filteredRoutes({
        [listPath('type=income')]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      }),
    );
    const { router } = renderApp(<MovementsContainer />);

    await screen.findByText(es.movements.list.empty);
    await userEvent.setup().selectOptions(filterField(es.movements.filters.type), 'income');

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(SIGN_IN);
    });
  });

  it('starts from the filters in the URL and ignores a malformed value (invalid input, AC-01)', async () => {
    const { calls } = stubApi(
      filteredRoutes({
        [listPath(`accountId=${CAJA_ID}&from=2026-10-01`)]: movementPage([
          movement({ note: 'Filtrada' }),
        ]),
      }),
    );
    renderApp(<MovementsContainer />, {
      search: `accountId=${CAJA_ID}&categoryId=nope&from=2026-10-01&to=2026-02-30&type=refund`,
    });

    expect(await screen.findByText('Filtrada')).toBeDefined();
    expect(listCalls(calls)).toEqual([listPath(`accountId=${CAJA_ID}&from=2026-10-01`)]);
    expect(filterField(es.movements.filters.account).value).toBe(CAJA_ID);
    expect(filterField(es.movements.filters.category).value).toBe('');
    expect(filterField(es.movements.filters.type).value).toBe('');
  });

  it('writes the filters to the URL so a reload or the back button keeps them', async () => {
    stubApi(filteredRoutes());
    const { router } = renderApp(<MovementsContainer />);

    await screen.findByText(es.movements.list.empty);
    await userEvent.setup().selectOptions(filterField(es.movements.filters.account), CAJA_ID);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        `/es/movements?accountId=${CAJA_ID}`,
        expect.anything(),
      );
    });
  });

  it('loads the reference data once: changing a filter reloads only the list and the bar keeps its focus', async () => {
    const { calls } = stubApi(
      filteredRoutes({
        [listPath('type=income')]: movementPage([movement({ note: 'Nota de ingreso' })]),
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText(es.movements.list.empty);
    const type = filterField(es.movements.filters.type);
    type.focus();
    await user.selectOptions(type, 'income');
    await screen.findByText('Nota de ingreso');

    expect(filterField(es.movements.filters.type)).toBe(type);
    expect(document.activeElement).toBe(type);
    const reference = calls.filter((call) => !call.path.startsWith('/movements'));
    expect(reference).toHaveLength(5);
    expect(calls.filter((call) => call.path === '/profile')).toHaveLength(1);
  });

  it('moves focus to the account select after "Clear filters" unmounts the button', async () => {
    stubApi(filteredRoutes());
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText(es.movements.list.empty);
    await user.selectOptions(filterField(es.movements.filters.type), 'income');
    await user.click(await screen.findByRole('button', { name: es.movements.filters.clear }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: es.movements.filters.clear })).toBeNull();
    });
    expect(document.activeElement).toBe(filterField(es.movements.filters.account));
  });

  it('moves focus to the account select after "Show all movements" unmounts the action', async () => {
    stubApi(
      filteredRoutes({
        [FIRST_PAGE]: movementPage([movement({ note: 'Todo' })]),
        [listPath('type=income')]: movementPage([]),
      }),
    );
    renderApp(<MovementsContainer />);
    const user = userEvent.setup();

    await screen.findByText('Todo');
    await user.selectOptions(filterField(es.movements.filters.type), 'income');
    await user.click(await screen.findByRole('button', { name: es.movements.filters.showAll }));

    expect(await screen.findByText('Todo')).toBeDefined();
    expect(screen.queryByRole('button', { name: es.movements.filters.showAll })).toBeNull();
    expect(document.activeElement).toBe(filterField(es.movements.filters.account));
  });

  it('does not take focus on first load or on an ordinary filter change (guard)', async () => {
    stubApi(
      filteredRoutes({
        [listPath('type=income')]: movementPage([movement({ note: 'Nota recibida' })]),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText(es.movements.list.empty);
    expect(document.activeElement).toBe(document.body);

    await userEvent.setup().selectOptions(filterField(es.movements.filters.type), 'income');
    await screen.findByText('Nota recibida');
    expect(document.activeElement).toBe(filterField(es.movements.filters.type));
  });

  it('each row shows its tags as chips (AC-03)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage([
          movement({ id: uuid(801), note: 'Con tags', tags: ['Viaje', 'Auto'] }),
          movement({ id: uuid(802), note: 'Sin tags', tags: [] }),
        ]),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText('Con tags');
    const [first, second] = rows();
    if (first === undefined || second === undefined) throw new Error('Expected two rows');
    const group = within(first).getByRole('group', { name: es.movements.list.tags });
    expect(within(group).getByText('Viaje')).toBeDefined();
    expect(within(group).getByText('Auto')).toBeDefined();
    expect(within(second).queryByRole('group')).toBeNull();
  });
});

describe('MovementsContainer: edit and delete (DISC-001-03e)', () => {
  const stored = movement({ id: uuid(500), note: 'Almuerzo' });
  const deletePath = `DELETE /movements/${uuid(500)}`;
  const actions = es.movements.list.actions;

  async function open(answers: Record<string, Parameters<typeof stubApi>[0][string]>) {
    const stub = stubApi(routes(answers));
    const view = renderApp(<MovementsContainer />);
    await screen.findByText('Almuerzo');
    return { ...stub, ...view };
  }

  it('shows an edit link to the edit route and a delete button on every row (AC-01)', async () => {
    await open({ [FIRST_PAGE]: movementPage([stored]) });

    const link = screen.getByRole('link', { name: `${actions.edit} Comida` });
    expect(link.getAttribute('href')).toBe(`/es/movements/edit?id=${uuid(500)}`);
    expect(screen.getByRole('button', { name: `${actions.delete} Comida` })).toBeDefined();
  });

  it('keeps the amount out of the accessible names of the actions (AC-02)', async () => {
    await open({ [FIRST_PAGE]: movementPage([stored]) });

    for (const name of [`${actions.edit} Comida`, `${actions.delete} Comida`]) {
      expect(name).not.toMatch(/\d/);
    }
    expect(screen.queryByRole('button', { name: /1\.500/ })).toBeNull();
  });

  it('asks before deleting, deletes on confirmation and the row disappears after the reload (AC-02)', async () => {
    const { calls } = await open({
      [FIRST_PAGE]: [movementPage([stored]), movementPage([])],
      [deletePath]: { status: 204 },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `${actions.delete} Comida` }));
    expect(screen.getByText(actions.confirmDelete)).toBeDefined();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: actions.confirmDeleteYes }));

    await waitFor(() => {
      expect(screen.queryByText('Almuerzo')).toBeNull();
    });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(calls.filter((call) => call.path === '/movements?limit=100')).toHaveLength(2);
  });

  it('deletes nothing when the confirmation is cancelled (AC-02)', async () => {
    const { calls } = await open({ [FIRST_PAGE]: movementPage([stored]) });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `${actions.delete} Comida` }));
    await user.click(screen.getByRole('button', { name: actions.cancel }));

    expect(screen.queryByText(actions.confirmDelete)).toBeNull();
    expect(screen.getByText('Almuerzo')).toBeDefined();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('keeps the row and shows the error when the delete fails (error path)', async () => {
    await open({
      [FIRST_PAGE]: movementPage([stored]),
      [deletePath]: { status: 500, body: { code: 'INTERNAL' } },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `${actions.delete} Comida` }));
    await user.click(screen.getByRole('button', { name: actions.confirmDeleteYes }));

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    expect(screen.getByText('Almuerzo')).toBeDefined();
    expect(screen.queryByText(actions.confirmDelete)).toBeNull();
  });

  it('reloads the list without an error when the movement was already deleted: 404 (AC-03)', async () => {
    const { calls } = await open({
      [FIRST_PAGE]: [movementPage([stored]), movementPage([])],
      [deletePath]: { status: 404, body: { code: 'NOT_FOUND' } },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `${actions.delete} Comida` }));
    await user.click(screen.getByRole('button', { name: actions.confirmDeleteYes }));

    await waitFor(() => {
      expect(screen.queryByText('Almuerzo')).toBeNull();
    });
    expect(screen.queryByText(es.errors.unexpected)).toBeNull();
    expect(calls.filter((call) => call.path === '/movements?limit=100')).toHaveLength(2);
  });

  it('goes to sign in when the delete answers 401 (error path)', async () => {
    const { router } = await open({
      [FIRST_PAGE]: movementPage([stored]),
      [deletePath]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `${actions.delete} Comida` }));
    await user.click(screen.getByRole('button', { name: actions.confirmDeleteYes }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });
});

describe('MovementsContainer: without connectivity (DISC-001-04a)', () => {
  const ANA = '11111111-1111-4111-8111-111111111111';

  const preferences = {
    defaultRateType: 'blue',
    displayCurrency: 'ARS',
    timeZone: TIME_ZONE,
    language: 'es',
  } as const;

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  }

  /** What an earlier online visit left on the device: the reference data and the movements. */
  async function seedCopy(movements: unknown[]): Promise<void> {
    const store = await openLocalStore(ANA);
    await saveReferenceData(store, {
      accounts: [account()],
      categories: [
        categoryFixture({ id: COMIDA_ID, kind: 'expense', name: 'Comida', icon: 'utensils' }),
      ],
      tags: [],
      preferences,
      rates: [],
    });
    await replaceMovements(store, movements);
    store.close();
  }

  async function replaceMovements(store: LocalStore, movements: unknown[]): Promise<void> {
    await store.replaceAll('movements', movements);
  }

  async function savedMovements(): Promise<MovementResponse[]> {
    const store = await openLocalStore(ANA);
    const saved = await loadRecentMovements(store);
    store.close();
    return saved;
  }

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    writeSessionPointer({ userId: ANA, emailVerified: true });
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  const recent = (index: number, note: string) =>
    movement({
      id: uuid(600 + index),
      note,
      occurredAt: new Date(Date.UTC(2026, 9, 1, 12, index)).toISOString(),
    });

  it('offline, shows the saved movements with the offline notice and a disabled filter bar (AC-02)', async () => {
    await seedCopy([recent(1, 'Almuerzo'), recent(2, 'Cena')]);
    setOnline(false);
    const { fetch } = stubApi({});

    renderApp(<MovementsContainer />);

    expect(await screen.findByText('Cena')).toBeDefined();
    expect(screen.getByText('Almuerzo')).toBeDefined();
    expect(screen.getByText(es.movements.list.offlineNotice)).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>(es.movements.filters.account).disabled).toBe(
      true,
    );
    expect(within(rows()[0] as HTMLElement).getByText('Comida')).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves the movements of an online load that has no filter (FR-02)', async () => {
    stubApi(routes({ [FIRST_PAGE]: movementPage([recent(1, 'Almuerzo'), recent(2, 'Cena')]) }));

    renderApp(<MovementsContainer />);
    await screen.findByText('Cena');

    await waitFor(async () => {
      expect((await savedMovements()).map((item) => item.note)).toEqual(['Cena', 'Almuerzo']);
    });
  });

  it('does not overwrite the saved movements with a filtered load (FR-02)', async () => {
    await seedCopy([recent(1, 'Almuerzo'), recent(2, 'Cena'), recent(3, 'Merienda')]);
    stubApi(
      routes({ 'GET /movements?limit=100&tag=Viaje': movementPage([recent(4, 'Viaje a Salta')]) }),
    );

    renderApp(<MovementsContainer />, { search: 'tag=Viaje' });
    await screen.findByText('Viaje a Salta');

    expect((await savedMovements()).map((item) => item.note)).toEqual([
      'Merienda',
      'Cena',
      'Almuerzo',
    ]);
  });

  it('falls back to the saved movements when the first list request fails with a network error (FR-03)', async () => {
    await seedCopy([recent(1, 'Almuerzo')]);
    stubApi(routes({ [FIRST_PAGE]: 'network-error' }));

    renderApp(<MovementsContainer />);

    expect(await screen.findByText('Almuerzo')).toBeDefined();
    expect(screen.getByText(es.movements.list.offlineNotice)).toBeDefined();
  });

  it('offline with nothing saved shows the empty state and the notice, not an error (FR-03)', async () => {
    await seedCopy([]);
    setOnline(false);
    stubApi({});

    renderApp(<MovementsContainer />);

    expect(await screen.findByText(es.movements.list.emptyTitle)).toBeDefined();
    expect(screen.getByText(es.movements.list.offlineNotice)).toBeDefined();
  });

  it('offline with no copy at all shows the connect-once message, not a crash (FR-03)', async () => {
    setOnline(false);
    stubApi({});

    renderApp(<MovementsContainer />);

    expect(await screen.findByText(es.errors.offlineNoCopy)).toBeDefined();
  });
});

describe('MovementsContainer: pending movements (DISC-001-04b)', () => {
  const ANA = '11111111-1111-4111-8111-111111111111';
  const TAXI_ID = uuid(700);

  const preferences = {
    defaultRateType: 'blue',
    displayCurrency: 'ARS',
    timeZone: TIME_ZONE,
    language: 'es',
  } as const;

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  }

  async function seedCopy(movements: unknown[]): Promise<void> {
    const store = await openLocalStore(ANA);
    await saveReferenceData(store, {
      accounts: [account()],
      categories: [
        categoryFixture({ id: COMIDA_ID, kind: 'expense', name: 'Comida', icon: 'utensils' }),
      ],
      tags: [],
      preferences,
      rates: [],
    });
    await store.replaceAll('movements', movements);
    store.close();
  }

  function taxi(id = TAXI_ID): QueuedRequest {
    return {
      id,
      type: 'expense',
      accountId: CAJA_ID,
      categoryId: COMIDA_ID,
      amount: '250000',
      occurredAt: '2026-10-03T12:00:00.000Z',
      note: 'Taxi',
      rate: { source: 'manual', value: '12505000' },
    };
  }

  async function queue(request: QueuedRequest, rejectedWith?: string): Promise<void> {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, request, new Date('2026-10-03T12:01:00.000Z'));
    if (rejectedWith !== undefined) await markRejected(store, request.id, rejectedWith);
    store.close();
  }

  const recent = (index: number, note: string) =>
    movement({
      id: uuid(600 + index),
      note,
      occurredAt: new Date(Date.UTC(2026, 9, 1, 12, index)).toISOString(),
    });

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    writeSessionPointer({ userId: ANA, emailVerified: true });
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it('shows a movement saved offline as pending, ahead of the cached ones (AC-01)', async () => {
    await seedCopy([recent(1, 'Almuerzo')]);
    await queue(taxi());
    setOnline(false);
    stubApi({});

    renderApp(<MovementsContainer />);

    expect(await screen.findByText('Taxi')).toBeDefined();
    const [first, second] = rows();
    expect(within(first as HTMLElement).getByText('Taxi')).toBeDefined();
    expect(within(first as HTMLElement).getByText(es.movements.list.pending)).toBeDefined();
    expect(within(second as HTMLElement).getByText('Almuerzo')).toBeDefined();
    expect(within(second as HTMLElement).queryByText(es.movements.list.pending)).toBeNull();
  });

  it('offers no edit or delete on a pending row (AC-01)', async () => {
    await seedCopy([recent(1, 'Almuerzo')]);
    await queue(taxi());
    setOnline(false);
    stubApi({});

    renderApp(<MovementsContainer />);
    await screen.findByText('Taxi');

    const { edit, delete: remove } = es.movements.list.actions;
    const [pending, cached] = rows() as [HTMLElement, HTMLElement];
    expect(within(pending).queryByRole('button', { name: `${remove} Comida` })).toBeNull();
    expect(within(pending).queryByRole('link', { name: `${edit} Comida` })).toBeNull();
    expect(within(cached).getByRole('button', { name: `${remove} Comida` })).toBeDefined();
    expect(within(cached).getByRole('link', { name: `${edit} Comida` })).toBeDefined();
  });

  it('shows the movement as pending again after the screen is mounted again (AC-04)', async () => {
    await seedCopy([]);
    await queue(taxi());
    setOnline(false);
    stubApi({});

    const first = renderApp(<MovementsContainer />);
    await screen.findByText('Taxi');
    first.unmount();
    renderApp(<MovementsContainer />);

    expect(await screen.findByText('Taxi')).toBeDefined();
    expect(screen.getByText(es.movements.list.pending)).toBeDefined();
  });

  it('does not show a queued movement twice once the loaded page already has it (FR-05)', async () => {
    await queue(taxi());
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage([
          movement({ id: TAXI_ID, note: 'Taxi', occurredAt: '2026-10-03T12:00:00.000Z' }),
        ]),
      }),
    );

    renderApp(<MovementsContainer />);
    await screen.findByText('Taxi');

    expect(screen.getAllByText('Taxi')).toHaveLength(1);
    expect(screen.queryByText(es.movements.list.pending)).toBeNull();
  });

  it('shows the pending movement next to the loaded page online while it has not been sent (FR-04)', async () => {
    await queue(taxi());
    stubApi(routes({ [FIRST_PAGE]: movementPage([recent(1, 'Almuerzo')]) }));

    renderApp(<MovementsContainer />);

    expect(await screen.findByText('Almuerzo')).toBeDefined();
    expect(await screen.findByText('Taxi')).toBeDefined();
    expect(screen.getAllByText(es.movements.list.pending)).toHaveLength(1);
  });

  it('does not show a movement the server refused: it stays queued for DISC-001-04c (FR-04)', async () => {
    await seedCopy([recent(1, 'Almuerzo')]);
    await queue(taxi(), 'ACCOUNT_ARCHIVED');
    setOnline(false);
    stubApi({});

    renderApp(<MovementsContainer />);
    await screen.findByText('Almuerzo');

    expect(screen.queryByText('Taxi')).toBeNull();
    expect(screen.queryByText(es.movements.list.pending)).toBeNull();
  });

  it('does not mix queued movements into a filtered page (AC-01)', async () => {
    await queue(taxi());
    stubApi(
      routes({
        'GET /movements?limit=100&tag=Viaje': movementPage([recent(4, 'Viaje a Salta')]),
      }),
    );

    renderApp(<MovementsContainer />, { search: 'tag=Viaje' });
    await screen.findByText('Viaje a Salta');

    expect(screen.queryByText('Taxi')).toBeNull();
    expect(screen.queryByText(es.movements.list.pending)).toBeNull();
  });

  it('leaves the list without pending rows and shows no error when the queue cannot be read (invalid input)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem('queue', { id: TAXI_ID, createdAt: 'not a date', request: { junk: true } });
    store.close();
    stubApi(routes({ [FIRST_PAGE]: movementPage([recent(1, 'Almuerzo')]) }));

    renderApp(<MovementsContainer />);

    expect(await screen.findByText('Almuerzo')).toBeDefined();
    expect(screen.queryByText(es.movements.list.pending)).toBeNull();
    expect(screen.queryByText(es.errors.unexpected)).toBeNull();
  });

  it('loads the list again when a pass has sent movements (FR-04)', async () => {
    const { fetch } = stubApi(routes({ [FIRST_PAGE]: movementPage([recent(1, 'Almuerzo')]) }));
    renderApp(<MovementsContainer />);
    await screen.findByText('Almuerzo');
    const before = fetch.mock.calls.length;

    window.dispatchEvent(new Event('pesly:sync-finished'));

    await waitFor(() => {
      expect(fetch.mock.calls.length).toBeGreaterThan(before);
    });
  });
});
