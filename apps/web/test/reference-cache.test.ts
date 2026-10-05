// @vitest-environment happy-dom
import type { AccountResponse, MovementResponse } from '@pesly/shared';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RECENT_MOVEMENTS_LIMIT,
  loadRecentMovements,
  loadReferenceData,
  saveRecentMovements,
  saveReferenceData,
  type ReferenceData,
} from '../src/lib/local-store/reference-cache';
import { openLocalStore, type LocalStore } from '../src/lib/local-store/stores';
import { category, uuid } from './support/category-fixtures';

const ANA = '11111111-1111-4111-8111-111111111111';

let store: LocalStore;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = await openLocalStore(ANA);
});

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

function reference(overrides: Partial<ReferenceData> = {}): ReferenceData {
  return {
    accounts: [account()],
    categories: [category({ id: uuid(11), kind: 'expense', name: 'Comida', icon: 'utensils' })],
    tags: ['Viaje', 'comida'],
    preferences: {
      defaultRateType: 'blue',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'es',
    },
    rates: [
      {
        rateType: 'blue',
        buy: '12400000',
        sell: '12505000',
        providerUpdatedAt: '2026-10-02T15:00:00.000Z',
        fetchedAt: '2026-10-02T15:30:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** A valid movement; the time is `index` minutes after midnight so the order is easy to read. */
function movement(index: number): MovementResponse {
  return {
    id: uuid(1000 + index),
    type: 'expense',
    accountId: uuid(1),
    categoryId: uuid(11),
    destinationAccountId: null,
    amount: '1000',
    destinationAmount: null,
    occurredAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    note: null,
    rate: '12505000',
    rateSource: 'automatic',
    rateType: 'blue',
    createdAt: '2026-10-01T00:00:00.000Z',
    tags: [],
  };
}

describe('reference data cache', () => {
  it('keeps the accounts, categories, tags, preferences and rates it saved (FR-01)', async () => {
    const data = reference();

    await saveReferenceData(store, data);
    const loaded = await loadReferenceData(store);

    expect(loaded).toEqual(data);
  });

  it('returns no copy, and no error, before anything was saved (FR-01)', async () => {
    expect(await loadReferenceData(store)).toBeNull();
    expect(await loadRecentMovements(store)).toEqual([]);
  });

  it('replaces the earlier reference data with the later one (FR-01)', async () => {
    await saveReferenceData(store, reference({ tags: ['old'] }));
    await saveReferenceData(store, reference({ tags: ['new'] }));

    expect((await loadReferenceData(store))?.tags).toEqual(['new']);
  });

  it('treats a corrupt stored record as invalid and returns no copy instead of throwing (FR-02)', async () => {
    await saveReferenceData(store, reference());
    await store.put('reference', 'accounts', [{ id: 'not an account' }]);

    expect(await loadReferenceData(store)).toBeNull();
  });
});

describe('recent movements cache', () => {
  it('keeps only the 100 most recent of 150 movements, newest first (AC-03)', async () => {
    const all = Array.from({ length: 150 }, (_, index) => movement(index));

    await saveRecentMovements(store, all);
    const loaded = await loadRecentMovements(store);

    expect(RECENT_MOVEMENTS_LIMIT).toBe(100);
    expect(loaded).toHaveLength(100);
    expect(loaded[0]?.id).toBe(movement(149).id);
    expect(loaded[99]?.id).toBe(movement(50).id);
    expect(loaded.some((item) => item.id === movement(49).id)).toBe(false);
  });

  it('replaces the earlier copy instead of adding to it (AC-03)', async () => {
    await saveRecentMovements(store, [movement(1), movement(2)]);
    await saveRecentMovements(store, [movement(3)]);

    const loaded = await loadRecentMovements(store);

    expect(loaded.map((item) => item.id)).toEqual([movement(3).id]);
  });

  it('orders by time even when the movements arrive shuffled (AC-03)', async () => {
    await saveRecentMovements(store, [movement(2), movement(9), movement(5)]);

    const loaded = await loadRecentMovements(store);

    expect(loaded.map((item) => item.id)).toEqual([movement(9).id, movement(5).id, movement(2).id]);
  });

  it('ignores a corrupt stored movement and keeps the valid ones (FR-02)', async () => {
    await saveRecentMovements(store, [movement(1), movement(2)]);
    // An invalid record: it has the key and the time but not the rest of a movement.
    await store.replaceAll('movements', [
      movement(1),
      { id: 'broken', occurredAt: '2026-10-05T00:00:00.000Z' },
    ]);

    const loaded = await loadRecentMovements(store);

    expect(loaded.map((item) => item.id)).toEqual([movement(1).id]);
  });
});
