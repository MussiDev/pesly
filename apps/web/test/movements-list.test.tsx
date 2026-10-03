// @vitest-environment happy-dom
import { formatMoney, type AccountResponse, type CategoryResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MovementsContainer } from '../src/features/movements/containers/movements-container';
import { formatRate } from '../src/features/movements/format-rate';
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

      await screen.findByText(es.movements.list.exchangeTitle);
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

      await screen.findByText(es.movements.list.exchangeTitle);
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

      await screen.findByText(es.movements.list.transferTitle);
      const [row] = rows();
      if (row === undefined) throw new Error('Expected a row');
      expect(within(row).getByText('Dolares viejos')).toBeDefined();
    });

    it('a destination id missing from the loaded sets shows the placeholder and does not fail (error path, AC-08)', async () => {
      stubApi(
        routes({ [FIRST_PAGE]: movementPage([transfer({ destinationAccountId: uuid(99) })]) }),
      );
      renderApp(<MovementsContainer />);

      await screen.findByText(es.movements.list.transferTitle);
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
