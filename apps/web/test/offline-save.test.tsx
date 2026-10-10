// @vitest-environment happy-dom
import type { AccountResponse } from '@pesly/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateMovementContainer } from '../src/features/movements/containers/create-movement-container';
import { loadQueue } from '../src/lib/local-store/queue';
import { saveReferenceData, type ReferenceData } from '../src/lib/local-store/reference-cache';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { MOVEMENT_QUEUED_EVENT } from '../src/lib/sync/sync-events';
import { category, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi } from './support/render-app';
import { typeButton } from './support/type-button';
import { categoryRadio } from './support/category-radio';

const { es } = CATALOGS;

const ANA = '11111111-1111-4111-8111-111111111111';
/** 12:30 in Buenos Aires (UTC-3). */
const NOW = '2026-10-02T15:30:00.000Z';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CAJA = uuid(1);
const DOLARES = uuid(2);
const BANCO = uuid(3);
const COMIDA = uuid(11);

const PROFILE = 'GET /profile';
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const CATEGORIES = 'GET /categories?archived=false&limit=100';
const RATES = 'GET /exchange-rates/latest';
const TAGS = 'GET /tags/all?limit=100';
const POST = 'POST /movements';

function account(overrides: Partial<AccountResponse> = {}): AccountResponse {
  return {
    id: CAJA,
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

const ACCOUNT_LIST = [
  account(),
  account({ id: DOLARES, name: 'Dolares', currency: 'USD' }),
  account({ id: BANCO, name: 'Banco' }),
];

const PREFERENCES = {
  defaultRateType: 'blue',
  displayCurrency: 'ARS',
  timeZone: 'America/Argentina/Buenos_Aires',
  language: 'es',
} as const;

const RATE = {
  rateType: 'blue',
  buy: '12400000',
  sell: '12505000',
  providerUpdatedAt: NOW,
  fetchedAt: NOW,
} as const;

const CATEGORY_LIST = [category({ id: COMIDA, kind: 'expense', name: 'Comida', icon: 'utensils' })];

function cached(overrides: Partial<ReferenceData> = {}): ReferenceData {
  return {
    accounts: ACCOUNT_LIST,
    categories: CATEGORY_LIST,
    tags: [],
    preferences: PREFERENCES,
    rates: [RATE],
    ...overrides,
  };
}

const SAVED = {
  id: uuid(500),
  type: 'expense',
  accountId: CAJA,
  categoryId: COMIDA,
  destinationAccountId: null,
  amount: '150050',
  destinationAmount: null,
  occurredAt: NOW,
  note: null,
  rate: '12505000',
  rateSource: 'automatic',
  rateType: 'blue',
  createdAt: NOW,
  tags: [],
};

function onlineRoutes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return {
    [PROFILE]: {
      status: 200,
      body: {
        displayName: 'Ana',
        email: 'ana@example.com',
        twoFactorEnabled: false,
        deletionReauth: 'password',
        preferences: PREFERENCES,
      },
    },
    [ACCOUNTS]: {
      status: 200,
      body: {
        items: ACCOUNT_LIST,
        availableTotals: { ARS: '0', USD: '0' },
        netWorthTotals: { ARS: '0', USD: '0' },
        debtTotals: { ARS: '0', USD: '0' },
        creditCardCount: 0,
        total: ACCOUNT_LIST.length,
        limit: 100,
        offset: 0,
      },
    },
    [CATEGORIES]: {
      status: 200,
      body: { items: CATEGORY_LIST, total: 1, limit: 100, offset: 0 },
    },
    [RATES]: { status: 200, body: { rates: [RATE] } },
    [TAGS]: { status: 200, body: { items: [], total: 0, limit: 100, offset: 0 } },
    [POST]: { status: 201, body: SAVED },
    ...overrides,
  };
}

async function seedCopy(data: ReferenceData = cached()): Promise<void> {
  const store = await openLocalStore(ANA);
  await saveReferenceData(store, data);
  store.close();
}

async function queued() {
  const store = await openLocalStore(ANA);
  const items = await loadQueue(store);
  store.close();
  return items.filter((item) => item.operation === 'create');
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const submit = () => screen.getByRole('button', { name: es.movements.form.submit });

/** Opens the entry screen offline, built from the copy an earlier online visit left. */
async function openOffline(data: ReferenceData = cached()) {
  await seedCopy(data);
  setOnline(false);
  const stub = stubApi({});
  renderApp(<CreateMovementContainer />);
  await screen.findByLabelText(es.movements.fields.amount);
  return { ...stub, user: userEvent.setup() };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: ANA, emailVerified: true });
  setOnline(true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe('saving a movement without a connection (DISC-001-04b)', () => {
  it('queues a valid expense, makes no request, says it is pending and clears the form (AC-01)', async () => {
    const { fetch, user } = await openOffline();
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.click(categoryRadio(COMIDA));
    await user.type(field(es.movements.fields.amount), '1.500,50');

    await user.click(submit());

    expect(await screen.findByText(es.movements.saved.titleOffline)).toBeDefined();
    expect(screen.getByText(es.movements.saved.pendingBody)).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    const items = await queued();
    expect(items).toHaveLength(1);
    expect(items[0]?.request).toMatchObject({
      type: 'expense',
      accountId: CAJA,
      categoryId: COMIDA,
      amount: '150050',
      // The rate the person saw is the one that gets frozen.
      rate: { source: 'manual', value: '12505000' },
    });
    expect(field(es.movements.fields.amount).value).toBe('');
  });

  it('queues a valid transfer and a valid exchange as pending (AC-02)', async () => {
    const { user } = await openOffline();
    await user.click(typeButton('transfer'));
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.selectOptions(field(es.movements.fields.destinationAccount), BANCO);
    await user.type(field(es.movements.fields.amount), '500,00');
    await user.click(submit());
    await screen.findByText(es.movements.saved.titleOffline);

    await user.click(typeButton('exchange'));
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.selectOptions(field(es.movements.fields.destinationAccount), DOLARES);
    await user.type(field(es.movements.fields.amountOut), '1.450,00');
    await user.type(field(es.movements.fields.amountIn), '1,00');
    await user.click(submit());

    await waitFor(async () => {
      expect(await queued()).toHaveLength(2);
    });
    const items = await queued();
    expect(items.map((item) => item.request.type).sort()).toEqual(['exchange', 'transfer']);
    expect(items.find((item) => item.request.type === 'transfer')?.request).toMatchObject({
      accountId: CAJA,
      destinationAccountId: BANCO,
      amount: '50000',
    });
  });

  it('gives every save a UUID, queued offline and sent online (AC-03)', async () => {
    const { user } = await openOffline();
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.click(categoryRadio(COMIDA));
    await user.type(field(es.movements.fields.amount), '100');
    await user.click(submit());
    await screen.findByText(es.movements.saved.titleOffline);
    const [stored] = await queued();
    expect(stored?.id).toMatch(UUID_PATTERN);
    expect(stored?.request.id).toBe(stored?.id);
  });

  it('sends a UUID with a save made online too (AC-03)', async () => {
    const { calls } = stubApi(onlineRoutes());
    renderApp(<CreateMovementContainer />);
    await screen.findByLabelText(es.movements.fields.amount);
    const user = userEvent.setup();
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.click(categoryRadio(COMIDA));
    await user.type(field(es.movements.fields.amount), '100');

    await user.click(submit());

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
    const body = calls.find((call) => call.method === 'POST')?.body as { id?: string };
    expect(body.id).toMatch(UUID_PATTERN);
  });

  it('queues the same id the request carried when an online save fails with a network error, and announces it (FR-02)', async () => {
    const { calls } = stubApi(onlineRoutes({ [POST]: 'network-error' }));
    const announced = vi.fn();
    window.addEventListener(MOVEMENT_QUEUED_EVENT, announced);
    try {
      renderApp(<CreateMovementContainer />);
      await screen.findByLabelText(es.movements.fields.amount);
      const user = userEvent.setup();
      await user.selectOptions(field(es.movements.fields.account), CAJA);
      await user.click(categoryRadio(COMIDA));
      await user.type(field(es.movements.fields.amount), '100');

      await user.click(submit());

      expect(await screen.findByText(es.movements.saved.titleOffline)).toBeDefined();
      const sent = calls.find((call) => call.method === 'POST')?.body as { id?: string };
      const [stored] = await queued();
      expect(stored?.id).toBe(sent.id);
      expect(announced).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(MOVEMENT_QUEUED_EVENT, announced);
    }
  });

  it('refuses an expense with no stored rate and no typed rate, and queues nothing (AC-07)', async () => {
    const { user } = await openOffline(cached({ rates: [] }));
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.click(categoryRadio(COMIDA));
    await user.type(field(es.movements.fields.amount), '100');

    await user.click(submit());

    expect(await screen.findByText(es.movements.errors.rateRequired)).toBeDefined();
    expect(await queued()).toEqual([]);
  });

  it('queues it once the person types a rate when none is stored (AC-07)', async () => {
    const { user } = await openOffline(cached({ rates: [] }));
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.click(categoryRadio(COMIDA));
    await user.type(field(es.movements.fields.amount), '100');
    await user.type(field(es.movements.fields.rate), '1.300,25');

    await user.click(submit());

    await screen.findByText(es.movements.saved.titleOffline);
    expect((await queued())[0]?.request).toMatchObject({
      rate: { source: 'manual', value: '13002500' },
    });
  });

  it('keeps the form filled and says the save failed when the device cannot store it (invalid input)', async () => {
    const { user } = await openOffline();
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.click(categoryRadio(COMIDA));
    await user.type(field(es.movements.fields.amount), '100');
    // The screen is already built from the copy; from here on the device cannot write.
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await user.click(submit());

    expect(await screen.findByText(es.errors.offlineSaveFailed)).toBeDefined();
    expect(field(es.movements.fields.amount).value).toBe('100');
    expect(screen.queryByText(es.movements.saved.titleOffline)).toBeNull();
  });

  it('keeps its message and queues nothing when the server refuses an online save (invalid input)', async () => {
    stubApi(onlineRoutes({ [POST]: { status: 400, body: { code: 'ACCOUNT_ARCHIVED' } } }));
    renderApp(<CreateMovementContainer />);
    await screen.findByLabelText(es.movements.fields.amount);
    const user = userEvent.setup();
    await user.selectOptions(field(es.movements.fields.account), CAJA);
    await user.click(categoryRadio(COMIDA));
    await user.type(field(es.movements.fields.amount), '100');

    await user.click(submit());

    expect(await screen.findByText(es.movements.errors.accountArchived)).toBeDefined();
    expect(await queued()).toEqual([]);
  });
});
