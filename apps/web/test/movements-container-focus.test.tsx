// @vitest-environment happy-dom
import type { AccountResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovementsContainer } from '../src/features/movements/containers/movements-container';
import { enqueueMovement } from '../src/lib/local-store/queue';
import { saveReferenceData } from '../src/lib/local-store/reference-cache';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { category as categoryFixture, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

const TIME_ZONE = 'America/Argentina/Buenos_Aires';
const FIRST_PAGE = 'GET /movements?limit=100';
const GROUPS = 'GET /groups';
const CAJA_ID = uuid(1);
const COMIDA_ID = uuid(11);
const GROUP_ID = uuid(700);
const ANA = '11111111-1111-4111-8111-111111111111';

const account: AccountResponse = {
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
};

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

function movementPage(items: unknown[], groupLinks: Record<string, unknown> = {}) {
  return { status: 200, body: { items, total: items.length, limit: 100, offset: 0, groupLinks } };
}

function link(adopted = false) {
  return { groupId: GROUP_ID, expenseId: uuid(800), adopted };
}

const groupList = (name = 'Depto') => ({
  status: 200,
  body: [
    {
      id: GROUP_ID,
      name,
      defaultRateType: 'blue',
      role: 'admin',
      memberCount: 2,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
});

function routes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  const categoryPage = (items: unknown[]) => ({
    status: 200,
    body: { items, total: items.length, limit: 100, offset: 0 },
  });
  const accounts = (items: AccountResponse[]) => ({
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
  });
  return {
    'GET /profile': {
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
    'GET /accounts?archived=false&limit=100': accounts([account]),
    'GET /accounts?archived=true&limit=100': accounts([]),
    'GET /categories?archived=false&limit=100': categoryPage([
      categoryFixture({ id: COMIDA_ID, kind: 'expense', name: 'Comida', icon: 'utensils' }),
    ]),
    'GET /categories?archived=true&limit=100': categoryPage([]),
    [FIRST_PAGE]: movementPage([]),
    [GROUPS]: groupList(),
    ...overrides,
  };
}

const sendLinks = () =>
  screen.queryAllByRole('link', { name: new RegExp(es.movements.list.actions.sendToGroup) });
const groupCalls = (calls: { path: string }[]) => calls.filter((call) => call.path === '/groups');

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: ANA, emailVerified: true });
  setOnline(true);
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
});

describe('MovementsContainer: send to group (DISC-001-05i)', () => {
  it('offers the send link on an unlinked expense and not on income, a transfer or an exchange (AC-01, AC-02)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage([
          movement({ id: uuid(501), note: 'Cena fuera' }),
          movement({ id: uuid(502), type: 'income', note: 'Ingreso' }),
          movement({
            id: uuid(503),
            type: 'transfer',
            note: 'Transf',
            destinationAccountId: CAJA_ID,
          }),
          movement({
            id: uuid(504),
            type: 'exchange',
            note: 'Cambio',
            destinationAccountId: CAJA_ID,
            destinationAmount: '100',
          }),
        ]),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText('Cena fuera');
    const links = sendLinks();
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toContain(`/movements/send?id=${uuid(501)}`);
  });

  it('offers no send link offline, where the list is the device copy (AC-03)', async () => {
    const store = await openLocalStore(ANA);
    await saveReferenceData(store, {
      accounts: [account],
      categories: [
        categoryFixture({ id: COMIDA_ID, kind: 'expense', name: 'Comida', icon: 'utensils' }),
      ],
      tags: [],
      preferences: {
        defaultRateType: 'blue',
        displayCurrency: 'ARS',
        timeZone: TIME_ZONE,
        language: 'es',
      },
      rates: [],
    });
    await store.replaceAll('movements', [movement({ note: 'Guardado' })]);
    store.close();
    setOnline(false);
    const { fetch } = stubApi({});
    renderApp(<MovementsContainer />);

    await screen.findByText('Guardado');
    expect(sendLinks()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offers no send link on a row with a change waiting on the device (AC-03)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(
      store,
      {
        id: uuid(900),
        type: 'expense',
        accountId: CAJA_ID,
        categoryId: COMIDA_ID,
        amount: '250000',
        occurredAt: '2026-10-03T12:00:00.000Z',
        note: 'Taxi',
        rate: { source: 'manual', value: '12505000' },
      },
      new Date('2026-10-03T12:01:00.000Z'),
    );
    store.close();
    stubApi(routes({ [FIRST_PAGE]: movementPage([movement({ note: 'Servidor' })]) }));
    renderApp(<MovementsContainer />);

    await screen.findByText('Taxi');
    await screen.findByText('Servidor');
    const taxiRow = screen.getByText('Taxi').closest('li');
    if (taxiRow === null) throw new Error('Expected the Taxi row');
    expect(within(taxiRow).queryByRole('link', { name: /Enviar a un grupo/ })).toBeNull();
    expect(sendLinks()).toHaveLength(1);
  });

  it('shows "In group {name}" on a linked row, without a send link, and asks for the groups once (AC-04, AC-05, NFR-09)', async () => {
    const { calls } = stubApi(
      routes({
        [FIRST_PAGE]: movementPage(
          [
            movement({ id: uuid(501), note: 'Uno' }),
            movement({ id: uuid(502), note: 'Dos' }),
            movement({ id: uuid(503), note: 'Tres' }),
          ],
          { [uuid(501)]: link(), [uuid(502)]: link(true) },
        ),
      }),
    );
    renderApp(<MovementsContainer />);

    await screen.findByText('Uno');
    expect(
      await screen.findAllByText(es.movements.list.inGroup.replace('{name}', 'Depto')),
    ).toHaveLength(2);
    expect(sendLinks()).toHaveLength(1);
    expect(groupCalls(calls)).toHaveLength(1);
  });

  it('shows "In a group" when the group is not among the person groups or listGroups fails (AC-05)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage([movement({ id: uuid(501), note: 'Uno' })], {
          [uuid(501)]: { groupId: uuid(701), expenseId: uuid(800), adopted: false },
        }),
      }),
    );
    const first = renderApp(<MovementsContainer />);
    await screen.findByText(es.movements.list.inGroupUnknown);
    first.unmount();

    stubApi(
      routes({
        [FIRST_PAGE]: movementPage([movement({ id: uuid(501), note: 'Uno' })], {
          [uuid(501)]: link(),
        }),
        [GROUPS]: { status: 500, body: { code: 'INTERNAL' } },
      }),
    );
    renderApp(<MovementsContainer />);
    await screen.findByText(es.movements.list.inGroupUnknown);
    expect(screen.getByText('Uno')).toBeDefined();
  });

  it('never asks for the groups when no loaded row is linked (NFR-09)', async () => {
    const { calls } = stubApi(routes({ [FIRST_PAGE]: movementPage([movement({ note: 'Solo' })]) }));
    renderApp(<MovementsContainer />);

    await screen.findByText('Solo');
    expect(sendLinks()).toHaveLength(1);
    expect(groupCalls(calls)).toHaveLength(0);
  });
});

describe('MovementsContainer: focus (DISC-001-05i)', () => {
  const rowsOf = () => [
    movement({ id: uuid(501), note: 'Uno' }),
    movement({ id: uuid(502), note: 'Dos' }),
  ];

  it('marks the focused row, scrolls to it, focuses it once and keeps its actions (AC-41, AC-42)', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    stubApi(routes({ [FIRST_PAGE]: movementPage(rowsOf()) }));
    renderApp(<MovementsContainer />, { search: `focus=${uuid(502)}` });

    await screen.findByText('Dos');
    const row = screen.getByText('Dos').closest('li');
    if (row === null) throw new Error('Expected the row');
    await waitFor(() => {
      expect(row.getAttribute('aria-current')).toBe('true');
    });
    expect(within(row).getByText(es.movements.list.highlighted)).toBeDefined();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
    expect(focus.mock.contexts).toContain(row);
    expect(screen.getByText('Uno').closest('li')?.getAttribute('aria-current') ?? null).toBeNull();
    expect(within(row).getByRole('link', { name: /Enviar a un grupo/ })).toBeDefined();
    await userEvent.setup().click(within(row).getByRole('button', { name: /Eliminar/ }));
    expect(within(row).getByText(es.movements.list.actions.confirmDelete)).toBeDefined();
  });

  it('makes the same requests with and without focus (NFR-09)', async () => {
    const plain = stubApi(routes({ [FIRST_PAGE]: movementPage(rowsOf()) }));
    const first = renderApp(<MovementsContainer />);
    await screen.findByText('Dos');
    first.unmount();
    const withoutFocus = plain.calls.map((call) => call.path).sort();

    const focused = stubApi(routes({ [FIRST_PAGE]: movementPage(rowsOf()) }));
    renderApp(<MovementsContainer />, { search: `focus=${uuid(502)}` });
    await screen.findByText('Dos');

    expect(focused.calls.map((call) => call.path).sort()).toEqual(withoutFocus);
  });

  it.each([
    ['a valid id that is not loaded', uuid(999)],
    ['a malformed value', 'abc'],
    ['a script tag', '<script>alert(1)</script>'],
  ])(
    'highlights nothing for %s, with no alert and no echo (AC-43, AC-44)',
    async (_name, value) => {
      const { calls } = stubApi(routes({ [FIRST_PAGE]: movementPage(rowsOf()) }));
      const { container } = renderApp(<MovementsContainer />, {
        search: `focus=${encodeURIComponent(value)}`,
      });

      await screen.findByText('Dos');
      expect(container.querySelector('[aria-current]')).toBeNull();
      expect(screen.queryByText(es.movements.list.highlighted)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(container.innerHTML).not.toContain(value);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(calls.every((call) => !call.path.includes('focus'))).toBe(true);
    },
  );

  it('drops focus from the address on a filter change and keeps the filters (FR-17)', async () => {
    stubApi(
      routes({
        [FIRST_PAGE]: movementPage(rowsOf()),
        [`GET /movements?limit=100&accountId=${CAJA_ID}`]: movementPage(rowsOf()),
      }),
    );
    const { router } = renderApp(<MovementsContainer />, { search: `focus=${uuid(502)}` });

    await screen.findByText('Dos');
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText(es.movements.filters.account), CAJA_ID);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalled();
    });
    const target = String(router.replace.mock.calls.at(-1)?.[0]);
    expect(target).toContain(`accountId=${CAJA_ID}`);
    expect(target).not.toContain('focus');
  });
});
