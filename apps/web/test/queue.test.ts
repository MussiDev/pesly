// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { QUEUE_STORE } from '../src/lib/local-store/database';
import {
  readQueuedMovements,
  rejectQueuedMovement,
  removeQueuedMovement,
  writeQueuedMovement,
} from '../src/lib/local-store/device-copy';
import {
  enqueueMovement,
  loadQueue,
  markRejected,
  queuedToMovement,
  removeQueued,
  type QueuedRequest,
} from '../src/lib/local-store/queue';
import { openLocalStore } from '../src/lib/local-store/stores';

const ANA = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '00000000-0000-4000-8000-000000000900';
const DESTINATION = '00000000-0000-4000-8000-000000000902';
const CATEGORY = '00000000-0000-4000-8000-000000000901';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (n: number): Date => new Date(Date.UTC(2026, 9, 2, 12, 0, 0, n));

beforeEach(() => {
  // A fresh in-memory IndexedDB per test, so no database outlives its test.
  globalThis.indexedDB = new IDBFactory();
});

function expenseRequest(n: number): QueuedRequest {
  return {
    id: id(n),
    type: 'expense',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    amount: '150050',
    occurredAt: '2026-10-02T15:30:00.000Z',
    note: 'lunch',
    tags: ['trip'],
    rate: { source: 'manual', value: '14000000' },
  };
}

function transferRequest(n: number): QueuedRequest {
  return {
    id: id(n),
    type: 'transfer',
    accountId: ACCOUNT,
    destinationAccountId: DESTINATION,
    amount: '5000',
    occurredAt: '2026-10-02T15:30:00.000Z',
  };
}

function exchangeRequest(n: number): QueuedRequest {
  return {
    id: id(n),
    type: 'exchange',
    accountId: ACCOUNT,
    destinationAccountId: DESTINATION,
    amount: '1450000',
    destinationAmount: '1000',
    occurredAt: '2026-10-02T15:30:00.000Z',
  };
}

describe('local queue of unsent movements', () => {
  it('reads a saved movement back through a new connection to the database (AC-04)', async () => {
    const first = await openLocalStore(ANA);
    await enqueueMovement(first, expenseRequest(1), at(1));
    first.close();

    const second = await openLocalStore(ANA);
    const queue = await loadQueue(second);
    second.close();

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: id(1), createdAt: at(1).toISOString() });
    expect(queue[0]?.request).toMatchObject({ type: 'expense', amount: '150050', id: id(1) });
  });

  it('still holds 5 queued movements after reopening the database (AC-04)', async () => {
    const first = await openLocalStore(ANA);
    for (let n = 1; n <= 5; n += 1) await enqueueMovement(first, expenseRequest(n), at(n));
    first.close();

    const second = await openLocalStore(ANA);
    const queue = await loadQueue(second);
    second.close();

    expect(queue.map((item) => item.id)).toEqual([1, 2, 3, 4, 5].map(id));
  });

  it('stores 1,000 queued movements and reads them back in createdAt order (NFR-01)', async () => {
    const store = await openLocalStore(ANA);
    // Saved out of order on purpose: the read must order them, not the writes.
    const order = Array.from({ length: 1000 }, (_, n) => n).reverse();
    for (const n of order) await enqueueMovement(store, expenseRequest(n + 1), at(n));

    const queue = await loadQueue(store);
    store.close();

    expect(queue).toHaveLength(1000);
    expect(queue[0]?.id).toBe(id(1));
    expect(queue[999]?.id).toBe(id(1000));
    expect(queue.map((item) => item.createdAt)).toEqual(
      [...queue.map((item) => item.createdAt)].sort(),
    );
  });

  it('keeps the queue when the cached movements are replaced by an online load (FR-03)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, expenseRequest(1), at(1));

    await store.replaceAll('movements', [{ id: 'cached', occurredAt: '2026-10-01T10:00:00.000Z' }]);
    await store.clear('movements');

    expect(await loadQueue(store)).toHaveLength(1);
    store.close();
  });

  it('removes a sent movement and keeps the others (FR-04)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, expenseRequest(1), at(1));
    await enqueueMovement(store, expenseRequest(2), at(2));

    await removeQueued(store, id(1));

    expect((await loadQueue(store)).map((item) => item.id)).toEqual([id(2)]);
    store.close();
  });

  it('flags a rejected movement with the error code and never deletes it (FR-04)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, expenseRequest(1), at(1));

    await markRejected(store, id(1), 'ACCOUNT_ARCHIVED');
    await markRejected(store, id(99), 'NOT_FOUND');

    const queue = await loadQueue(store);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.rejection).toEqual({ code: 'ACCOUNT_ARCHIVED' });
    store.close();
  });

  it('skips a record that does not parse when reading, and does not delete it (invalid input)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, expenseRequest(1), at(1));
    await store.putItem(QUEUE_STORE, {
      id: id(2),
      createdAt: 'not a date',
      request: { junk: true },
    });

    expect((await loadQueue(store)).map((item) => item.id)).toEqual([id(1)]);
    expect(await store.getAll(QUEUE_STORE)).toHaveLength(2);
    store.close();
  });

  it('refuses a request that carries no id and stores nothing (invalid input)', async () => {
    const store = await openLocalStore(ANA);
    const withoutId: Record<string, unknown> = { ...expenseRequest(1) };
    delete withoutId.id;

    await expect(
      // A request with no id never reaches the queue through the typed API; this checks the guard.
      enqueueMovement(store, withoutId as unknown as QueuedRequest, at(1)),
    ).rejects.toThrow();
    await expect(
      enqueueMovement(store, { ...expenseRequest(1), amount: '0' }, at(1)),
    ).rejects.toThrow();

    expect(await store.getAll(QUEUE_STORE)).toEqual([]);
    store.close();
  });

  it('reports not stored, and throws nothing, when IndexedDB does not exist (invalid input)', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(await writeQueuedMovement(ANA, expenseRequest(1))).toBe(false);
    expect(await readQueuedMovements(ANA)).toEqual([]);
    await expect(removeQueuedMovement(ANA, id(1))).resolves.toBeUndefined();
    await expect(rejectQueuedMovement(ANA, id(1), 'NOT_FOUND')).resolves.toBeUndefined();
  });

  it('reports not stored when no user is known (invalid input)', async () => {
    expect(await writeQueuedMovement(undefined, expenseRequest(1))).toBe(false);
    expect(await readQueuedMovements(undefined)).toEqual([]);
  });

  it('saves, reads, flags and removes through the per-user helpers (AC-04)', async () => {
    expect(await writeQueuedMovement(ANA, expenseRequest(1))).toBe(true);
    expect(await writeQueuedMovement(ANA, transferRequest(2))).toBe(true);

    await rejectQueuedMovement(ANA, id(2), 'ACCOUNT_ARCHIVED');
    const queue = await readQueuedMovements(ANA);
    expect(queue.map((item) => [item.id, item.rejection?.code])).toEqual([
      [id(1), undefined],
      [id(2), 'ACCOUNT_ARCHIVED'],
    ]);

    await removeQueuedMovement(ANA, id(1));
    expect((await readQueuedMovements(ANA)).map((item) => item.id)).toEqual([id(2)]);
  });
});

describe('queued movement as a list row', () => {
  const item = (request: QueuedRequest) => {
    const parsed = { id: request.id, request, createdAt: at(7).toISOString() };
    return parsed;
  };

  it('shows an expense with the manual rate it was saved with, its tags and its note (AC-02)', () => {
    const row = queuedToMovement(item(expenseRequest(1)));

    expect(row).toMatchObject({
      id: id(1),
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      destinationAccountId: null,
      amount: '150050',
      destinationAmount: null,
      note: 'lunch',
      rate: '14000000',
      rateSource: 'manual',
      rateType: null,
      tags: ['trip'],
      createdAt: at(7).toISOString(),
    });
  });

  it('shows an expense saved with an automatic rate without a rate value (AC-02)', () => {
    const row = queuedToMovement(
      item({ ...expenseRequest(1), rate: { source: 'automatic' } } as QueuedRequest),
    );

    expect(row).toMatchObject({ rate: null, rateSource: 'automatic', rateType: null });
  });

  it('shows a transfer with its destination, the same destination amount and no rate (AC-02)', () => {
    const row = queuedToMovement(item(transferRequest(2)));

    expect(row).toMatchObject({
      type: 'transfer',
      categoryId: null,
      destinationAccountId: DESTINATION,
      amount: '5000',
      destinationAmount: '5000',
      rate: null,
      rateSource: null,
      tags: [],
      note: null,
    });
  });

  it('shows an exchange with the rate implied by its two amounts when the currencies are known (AC-02)', () => {
    const currencies = new Map([
      [ACCOUNT, 'ARS'],
      [DESTINATION, 'USD'],
    ]);

    const row = queuedToMovement(item(exchangeRequest(3)), currencies);

    expect(row).toMatchObject({
      type: 'exchange',
      destinationAmount: '1000',
      rate: '14500000',
      rateSource: 'implied',
    });
  });

  it('reads the implied rate the other way round when the source account is in dollars (AC-02)', () => {
    const currencies = new Map([
      [ACCOUNT, 'USD'],
      [DESTINATION, 'ARS'],
    ]);
    const request: QueuedRequest = {
      ...exchangeRequest(3),
      amount: '1000',
      destinationAmount: '1450000',
    } as QueuedRequest;

    expect(queuedToMovement(item(request), currencies).rate).toBe('14500000');
  });

  it('leaves the rate of an exchange empty when the currencies are not known (invalid input)', () => {
    const row = queuedToMovement(item(exchangeRequest(3)));

    expect(row).toMatchObject({ rate: null, rateSource: 'implied' });
  });
});
