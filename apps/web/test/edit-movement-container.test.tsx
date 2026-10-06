// @vitest-environment happy-dom
import type { AccountResponse, CategoryResponse, MovementResponse } from '@pesly/shared';
import { formatRateInput } from '@pesly/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditMovementContainer } from '../src/features/movements/containers/edit-movement-container';
import { EditMovementRouteContainer } from '../src/features/movements/containers/edit-movement-route-container';
import { enqueueMovement, loadQueue, queueEdit } from '../src/lib/local-store/queue';
import { saveRecentMovements, saveReferenceData } from '../src/lib/local-store/reference-cache';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { MOVEMENT_QUEUED_EVENT } from '../src/lib/sync/sync-events';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';
import { category as categoryFixture, uuid } from './support/category-fixtures';

const { es } = CATALOGS;

/** 12:30 in Buenos Aires (UTC-3). */
const NOW = '2026-10-02T15:30:00.000Z';

const CAJA_ID = uuid(1);
const BANCO_ID = uuid(2);
const VIEJA_ID = uuid(3);
const COMIDA_ID = uuid(11);
const VIEJA_CATEGORY_ID = uuid(13);
const MOVEMENT_ID = uuid(99);

const GET_MOVEMENT = `GET /movements/${MOVEMENT_ID}`;
const PUT_MOVEMENT = `PUT /movements/${MOVEMENT_ID}`;

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

function category(overrides: Partial<CategoryResponse>) {
  return categoryFixture({ icon: 'utensils', ...overrides });
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

function page<T>(items: T[]) {
  return { status: 200, body: { items, total: items.length, limit: 100, offset: 0 } };
}

const PROFILE = {
  status: 200,
  body: {
    displayName: 'Ana',
    email: 'ana@example.com',
    twoFactorEnabled: false,
    deletionReauth: 'password',
    preferences: {
      defaultRateType: 'blue',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'es',
    },
  },
};

const RATES = {
  status: 200,
  body: {
    rates: [
      {
        rateType: 'blue',
        buy: '12505000',
        sell: '12505000',
        providerUpdatedAt: NOW,
        fetchedAt: NOW,
      },
    ],
  },
};

const STORED: MovementResponse = {
  id: MOVEMENT_ID,
  type: 'expense',
  accountId: CAJA_ID,
  categoryId: COMIDA_ID,
  destinationAccountId: null,
  amount: '150050',
  destinationAmount: null,
  occurredAt: NOW,
  note: 'almuerzo',
  rate: '9000000',
  rateSource: 'manual',
  rateType: null,
  createdAt: NOW,
  tags: ['Viaje'],
};

function routes(
  movement: MovementResponse = STORED,
  overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {},
) {
  return {
    'GET /profile': PROFILE,
    'GET /accounts?archived=false&limit=100': accountPage([
      account(),
      account({ id: BANCO_ID, name: 'Banco' }),
    ]),
    'GET /accounts?archived=true&limit=100': accountPage([
      account({ id: VIEJA_ID, name: 'Cuenta vieja', archived: true }),
    ]),
    'GET /categories?archived=false&limit=100': page([
      category({ id: COMIDA_ID, kind: 'expense', name: 'Comida' }),
    ]),
    'GET /categories?archived=true&limit=100': page([
      category({ id: VIEJA_CATEGORY_ID, kind: 'expense', name: 'Vieja', archived: true }),
    ]),
    'GET /exchange-rates/latest': RATES,
    [GET_MOVEMENT]: { status: 200, body: movement },
    [PUT_MOVEMENT]: { status: 200, body: { ...movement, amount: '9000' } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const save = () => screen.getByRole('button', { name: es.movements.form.save });
const puts = (calls: ApiCall[]) => calls.filter((call) => call.method === 'PUT');

async function open(answers = routes()) {
  const stub = stubApi(answers);
  const view = renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);
  await screen.findByRole('heading', { name: es.movements.edit.title });
  return { ...stub, ...view };
}

describe('EditMovementContainer: the filled-in screen', () => {
  it('loads the movement and shows its amount, date, account, category, note, tags and rate (AC-01)', async () => {
    await open();

    expect(field(es.movements.fields.amount).value).toBe('1.500,50');
    expect(field(es.movements.fields.occurredAt).value).toBe('2026-10-02T12:30');
    expect(field(es.movements.fields.account).value).toBe(CAJA_ID);
    expect(field(es.movements.fields.category).value).toBe(COMIDA_ID);
    expect(field(es.movements.fields.note).value).toBe('almuerzo');
    expect(field(es.movements.fields.rate).value).toBe(formatRateInput(9000000n, 'es'));
    expect(screen.getByText('Viaje')).toBeDefined();
  });

  it('locks the type: an edit cannot turn an expense into another kind (FR-01)', async () => {
    await open();

    const type = field(es.movements.fields.type) as unknown as HTMLSelectElement;
    expect(type.value).toBe('expense');
    expect(type.disabled).toBe(true);
  });

  it('offers the archived account and category the movement already uses (FR-01)', async () => {
    await open(
      routes({
        ...STORED,
        accountId: VIEJA_ID,
        categoryId: VIEJA_CATEGORY_ID,
      }),
    );

    expect(field(es.movements.fields.account).value).toBe(VIEJA_ID);
    expect(field(es.movements.fields.category).value).toBe(VIEJA_CATEGORY_ID);
  });

  it('shows a transfer with its destination and without category or rate (FR-01)', async () => {
    await open(
      routes({
        ...STORED,
        type: 'transfer',
        categoryId: null,
        destinationAccountId: BANCO_ID,
        destinationAmount: '150050',
        rate: null,
        rateSource: null,
        rateType: null,
        tags: [],
      }),
    );

    expect(field(es.movements.fields.destinationAccount).value).toBe(BANCO_ID);
    expect(screen.queryByLabelText(es.movements.fields.category)).toBeNull();
    expect(screen.queryByLabelText(es.movements.fields.rate)).toBeNull();
  });
});

describe('EditMovementContainer: saving', () => {
  it('sends the changed amount with the stored rate kept and goes back to the list (AC-01)', async () => {
    const { calls, router } = await open();
    const user = userEvent.setup();

    await user.clear(field(es.movements.fields.amount));
    await user.type(field(es.movements.fields.amount), '90');
    await user.click(save());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/movements');
    });
    expect(puts(calls)).toHaveLength(1);
    expect(puts(calls)[0]?.body).toEqual({
      type: 'expense',
      accountId: CAJA_ID,
      categoryId: COMIDA_ID,
      amount: '9000',
      occurredAt: NOW,
      note: 'almuerzo',
      tags: ['Viaje'],
      rate: { source: 'keep' },
    });
  });

  it('sends a manual rate once the user edits it (FR-01)', async () => {
    const { calls } = await open();
    const user = userEvent.setup();

    await user.clear(field(es.movements.fields.rate));
    await user.type(field(es.movements.fields.rate), '1300,25');
    await user.click(save());

    await waitFor(() => {
      expect(puts(calls)).toHaveLength(1);
    });
    expect(puts(calls)[0]?.body).toMatchObject({ rate: { source: 'manual', value: '13002500' } });
  });

  it('shows the date error and sends nothing when the date is after today (AC-04)', async () => {
    const { calls } = await open();
    const user = userEvent.setup();

    fireEvent.change(field(es.movements.fields.occurredAt), {
      target: { value: '2026-10-03T12:30' },
    });
    await user.click(save());

    expect(await screen.findByText(es.errors.movementDateInFuture)).toBeDefined();
    expect(puts(calls)).toHaveLength(0);
  });

  it('shows the amount error and sends nothing when the amount is 0 (AC-05)', async () => {
    const { calls } = await open();
    const user = userEvent.setup();

    await user.clear(field(es.movements.fields.amount));
    await user.type(field(es.movements.fields.amount), '0');
    await user.click(save());

    expect(await screen.findByText(es.movements.errors.amountNotPositive)).toBeDefined();
    expect(puts(calls)).toHaveLength(0);
  });

  it('keeps the form and shows the API message when the server rejects the edit (error path)', async () => {
    const { router } = await open(
      routes(STORED, {
        [PUT_MOVEMENT]: { status: 400, body: { code: 'MOVEMENT_DATE_IN_FUTURE' } },
      }),
    );
    const user = userEvent.setup();

    await user.click(save());

    expect(await screen.findByText(es.errors.movementDateInFuture)).toBeDefined();
    expect(field(es.movements.fields.note).value).toBe('almuerzo');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the not-found state when saving a movement that was deleted meanwhile (AC-03)', async () => {
    await open(routes(STORED, { [PUT_MOVEMENT]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    const user = userEvent.setup();

    await user.click(save());

    expect(await screen.findByText(es.movements.edit.notFound)).toBeDefined();
  });
});

describe('EditMovementContainer: loading failures', () => {
  it('shows the not-found state for a missing or foreign movement, not a crash (AC-03)', async () => {
    stubApi(routes(STORED, { [GET_MOVEMENT]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);

    expect(await screen.findByText(es.movements.edit.notFound)).toBeDefined();
    expect(screen.queryByLabelText(es.movements.fields.amount)).toBeNull();
  });

  it('shows the generic message with a retry when loading fails, and loads on retry (error path)', async () => {
    stubApi(
      routes(STORED, {
        [GET_MOVEMENT]: [
          { status: 500, body: { code: 'INTERNAL' } },
          { status: 200, body: STORED },
        ],
      }),
    );
    renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByLabelText(es.movements.fields.amount)).toBeDefined();
  });

  it('redirects to sign in when loading answers 401 (error path)', async () => {
    stubApi(
      routes(STORED, {
        [GET_MOVEMENT]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
        'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
      }),
    );
    const { router } = renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });
});

describe('EditMovementContainer: offline and the queue (DISC-001-04c)', () => {
  const ANA = '11111111-1111-4111-8111-111111111111';

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  }

  async function seed({ movements = [STORED] }: { movements?: MovementResponse[] } = {}) {
    const store = await openLocalStore(ANA);
    await saveReferenceData(store, {
      accounts: [account(), account({ id: BANCO_ID, name: 'Banco' })],
      categories: [category({ id: COMIDA_ID, kind: 'expense', name: 'Comida' })],
      tags: [],
      preferences: PROFILE.body.preferences as never,
      rates: RATES.body.rates as never,
    });
    await saveRecentMovements(store, movements);
    store.close();
  }

  async function queue() {
    const store = await openLocalStore(ANA);
    const items = await loadQueue(store);
    store.close();
    return items;
  }

  async function changeAmountAndSave(amount: string) {
    const user = userEvent.setup();
    await user.clear(field(es.movements.fields.amount));
    await user.type(field(es.movements.fields.amount), amount);
    await user.click(save());
  }

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    writeSessionPointer({ userId: ANA, emailVerified: true });
  });

  afterEach(() => {
    setOnline(true);
  });

  it('offline, opens a movement from the device copy with no request (AC-01)', async () => {
    await seed();
    setOnline(false);
    const { calls } = stubApi({});

    renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);

    expect(await screen.findByRole('heading', { name: es.movements.edit.title })).toBeDefined();
    expect(field(es.movements.fields.amount).value).toBe('1.500,50');
    expect(calls).toEqual([]);
  });

  it('offline, queues the edit, sends nothing and goes back to the list (AC-01)', async () => {
    await seed();
    setOnline(false);
    const { calls } = stubApi({});
    const { router } = renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);
    await screen.findByRole('heading', { name: es.movements.edit.title });

    await changeAmountAndSave('90');

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/movements');
    });
    expect(calls).toEqual([]);
    expect(await queue()).toMatchObject([
      {
        id: MOVEMENT_ID,
        operation: 'update',
        request: { amount: '9000', rate: { source: 'keep' } },
      },
    ]);
  });

  it('opens a movement with a queued create with its queued values, and folds the edit into it (AC-01)', async () => {
    await seed({ movements: [] });
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, {
      id: MOVEMENT_ID,
      type: 'expense',
      accountId: CAJA_ID,
      categoryId: COMIDA_ID,
      amount: '4200',
      occurredAt: NOW,
      rate: { source: 'manual', value: '9000000' },
    });
    store.close();
    setOnline(false);
    stubApi({});
    renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);
    await screen.findByRole('heading', { name: es.movements.edit.title });
    expect(field(es.movements.fields.amount).value).toBe('42,00');

    await changeAmountAndSave('50');

    await waitFor(async () => {
      expect(await queue()).toMatchObject([
        { operation: 'create', request: { id: MOVEMENT_ID, amount: '5000' } },
      ]);
    });
  });

  it('online with no queued change, a network failure of PUT queues the same edit and announces it (FR-01)', async () => {
    await seed();
    const heard = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, heard);
    const { calls, router } = await open(routes(STORED, { [PUT_MOVEMENT]: 'network-error' }));

    await changeAmountAndSave('90');

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/movements');
    });
    window.removeEventListener(MOVEMENT_QUEUED_EVENT, heard);
    expect(puts(calls)).toHaveLength(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await queue()).toMatchObject([{ operation: 'update', request: { amount: '9000' } }]);
  });

  it('online with a queued change, saving queues it and announces it instead of sending PUT (FR-04)', async () => {
    await seed();
    const store = await openLocalStore(ANA);
    await queueEdit(store, STORED, {
      type: 'expense',
      accountId: CAJA_ID,
      categoryId: COMIDA_ID,
      amount: '7000',
      occurredAt: NOW,
      rate: { source: 'keep' },
    });
    store.close();
    const heard = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, heard);
    const { calls, router } = await open();
    expect(field(es.movements.fields.amount).value).toBe('70,00');

    await changeAmountAndSave('80');

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/es/movements');
    });
    window.removeEventListener(MOVEMENT_QUEUED_EVENT, heard);
    expect(puts(calls)).toEqual([]);
    expect(calls.some((call) => call.path === `/movements/${MOVEMENT_ID}`)).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await queue()).toMatchObject([{ revision: 2, request: { amount: '8000' } }]);
  });

  it('offline, says the movement is not available when neither the queue nor the copy has it (invalid input)', async () => {
    await seed({ movements: [] });
    setOnline(false);
    stubApi({});

    renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);

    expect(await screen.findByText(es.movements.edit.notAvailableOffline)).toBeDefined();
  });

  it('keeps the form and shows the save failure when the queued edit cannot be stored (invalid input)', async () => {
    await seed();
    setOnline(false);
    stubApi({});
    const { router } = renderApp(<EditMovementContainer movementId={MOVEMENT_ID} />);
    await screen.findByRole('heading', { name: es.movements.edit.title });
    // The device forgets who is signed in: there is no queue to write to.
    localStorage.clear();

    await changeAmountAndSave('90');

    expect(await screen.findByText(es.errors.offlineSaveFailed)).toBeDefined();
    expect(field(es.movements.fields.amount).value).toBe('90');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens the movement named by the query, and shows not found for a malformed or missing id (invalid input)', async () => {
    stubApi(routes());
    const first = renderApp(<EditMovementRouteContainer />, { search: `id=${MOVEMENT_ID}` });
    expect(await screen.findByRole('heading', { name: es.movements.edit.title })).toBeDefined();
    first.unmount();

    const { calls } = stubApi(routes());
    const second = renderApp(<EditMovementRouteContainer />, { search: 'id=not-a-uuid' });
    expect(await screen.findByText(es.movements.edit.notFound)).toBeDefined();
    second.unmount();

    renderApp(<EditMovementRouteContainer />);
    expect(await screen.findByText(es.movements.edit.notFound)).toBeDefined();
    expect(calls.some((call) => call.path.startsWith('/movements/'))).toBe(false);
  });
});
