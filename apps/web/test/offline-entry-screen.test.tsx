// @vitest-environment happy-dom
import type { AccountResponse } from '@pesly/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateMovementContainer } from '../src/features/movements/containers/create-movement-container';
import {
  loadReferenceData,
  saveReferenceData,
  type ReferenceData,
} from '../src/lib/local-store/reference-cache';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { category, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

const ANA = '11111111-1111-4111-8111-111111111111';
/** 12:30 in Buenos Aires (UTC-3). */
const NOW = '2026-10-02T15:30:00.000Z';

const PROFILE = 'GET /profile';
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const CATEGORIES = 'GET /categories?archived=false&limit=100';
const RATES = 'GET /exchange-rates/latest';
const TAGS = 'GET /tags/all?limit=100';

function account(overrides: Partial<AccountResponse> = {}): AccountResponse {
  return {
    id: uuid(1),
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

function cached(overrides: Partial<ReferenceData> = {}): ReferenceData {
  return {
    accounts: [account()],
    categories: [category({ id: uuid(11), kind: 'expense', name: 'Comida', icon: 'utensils' })],
    tags: ['Viaje', 'vino', 'comida'],
    preferences: PREFERENCES,
    rates: [RATE],
    ...overrides,
  };
}

function onlineRoutes() {
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
        items: [account()],
        availableTotals: { ARS: '0', USD: '0' },
        netWorthTotals: { ARS: '0', USD: '0' },
        debtTotals: { ARS: '0', USD: '0' },
        creditCardCount: 0,
        total: 1,
        limit: 100,
        offset: 0,
      },
    },
    [CATEGORIES]: {
      status: 200,
      body: {
        items: [category({ id: uuid(11), kind: 'expense', name: 'Comida', icon: 'utensils' })],
        total: 1,
        limit: 100,
        offset: 0,
      },
    },
    [RATES]: { status: 200, body: { rates: [RATE] } },
    [TAGS]: {
      status: 200,
      body: { items: ['Viaje', 'vino', 'comida'], total: 3, limit: 100, offset: 0 },
    },
  };
}

async function seedCopy(data: ReferenceData = cached()): Promise<void> {
  const store = await openLocalStore(ANA);
  await saveReferenceData(store, data);
  store.close();
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
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

describe('entry screen without connectivity', () => {
  it('offers the cached accounts, categories and tags and prefills the latest stored rate (AC-01)', async () => {
    await seedCopy();
    setOnline(false);
    stubApi({});

    renderApp(<CreateMovementContainer />);

    await screen.findByLabelText(es.movements.fields.amount);
    expect(screen.getByRole('option', { name: 'Caja (ARS)' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Comida' })).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(es.movements.fields.rate).value).toBe('1250,5');
  });

  it('suggests the cached tags that start with what is typed (FR-01)', async () => {
    await seedCopy();
    setOnline(false);
    stubApi({});
    renderApp(<CreateMovementContainer />);
    await screen.findByLabelText(es.movements.fields.amount);

    await userEvent.setup().type(screen.getByLabelText(es.movements.tags.label), 'vi');

    expect(await screen.findByText('Viaje')).toBeDefined();
    expect(screen.getByText('vino')).toBeDefined();
    expect(screen.queryByText('comida')).toBeNull();
  });

  it('makes no request at all while offline (AC-01)', async () => {
    await seedCopy();
    setOnline(false);
    const { fetch } = stubApi({});

    renderApp(<CreateMovementContainer />);
    await screen.findByLabelText(es.movements.fields.amount);
    await userEvent.setup().type(screen.getByLabelText(es.movements.tags.label), 'vi');
    await screen.findByText('Viaje');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the connect-once message with a retry when there is no cached copy, not a crash (AC-01)', async () => {
    setOnline(false);
    stubApi({});

    renderApp(<CreateMovementContainer />);

    expect(await screen.findByText(es.errors.offlineNoCopy)).toBeDefined();
    expect(screen.getByRole('button', { name: es.app.retry })).toBeDefined();
  });

  it('shows the same message when nobody signed in on this device yet (AC-01)', async () => {
    localStorage.clear();
    setOnline(false);
    stubApi({});

    renderApp(<CreateMovementContainer />);

    expect(await screen.findByText(es.errors.offlineNoCopy)).toBeDefined();
  });

  it('loads again from the API when the connection comes back (FR-01)', async () => {
    await seedCopy();
    setOnline(false);
    const { calls } = stubApi(onlineRoutes());
    renderApp(<CreateMovementContainer />);
    await screen.findByLabelText(es.movements.fields.amount);
    expect(calls).toHaveLength(0);

    setOnline(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(() => {
      expect(calls.map((call) => call.path)).toContain('/accounts?archived=false&limit=100');
    });
  });
});

describe('entry screen with connectivity', () => {
  it('writes accounts, categories, tags, preferences and rates through to the store (FR-01)', async () => {
    stubApi(onlineRoutes());

    renderApp(<CreateMovementContainer />);
    await screen.findByLabelText(es.movements.fields.amount);

    await waitFor(async () => {
      const store = await openLocalStore(ANA);
      const saved = await loadReferenceData(store);
      store.close();
      expect(saved?.accounts.map((item) => item.name)).toEqual(['Caja']);
      expect(saved?.categories.map((item) => item.name)).toEqual(['Comida']);
      expect(saved?.tags).toEqual(['Viaje', 'vino', 'comida']);
      expect(saved?.preferences.timeZone).toBe('America/Argentina/Buenos_Aires');
      expect(saved?.rates.map((item) => item.sell)).toEqual(['12505000']);
    });
  });

  it('keeps the entry screen working when only the tags fail to load (FR-01)', async () => {
    stubApi({ ...onlineRoutes(), [TAGS]: { status: 500, body: { code: 'INTERNAL' } } });

    renderApp(<CreateMovementContainer />);

    expect(await screen.findByLabelText(es.movements.fields.amount)).toBeDefined();
  });

  it('falls back to the cached copy when a request fails with a network error (FR-01)', async () => {
    await seedCopy();
    stubApi({ ...onlineRoutes(), [ACCOUNTS]: 'network-error' });

    renderApp(<CreateMovementContainer />);

    await screen.findByLabelText(es.movements.fields.amount);
    expect(screen.getByRole('option', { name: 'Caja (ARS)' })).toBeDefined();
  });

  it('keeps the network message when a request fails and nothing was cached (FR-01)', async () => {
    stubApi({ ...onlineRoutes(), [ACCOUNTS]: 'network-error' });

    renderApp(<CreateMovementContainer />);

    expect(await screen.findByText(es.errors.network)).toBeDefined();
  });

  it('still sends the user to sign in on a 401 and does not use the cached copy (FR-01)', async () => {
    await seedCopy();
    stubApi({
      ...onlineRoutes(),
      [PROFILE]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });

    const { router } = renderApp(<CreateMovementContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByLabelText(es.movements.fields.amount)).toBeNull();
  });
});
