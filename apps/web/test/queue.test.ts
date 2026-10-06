// @vitest-environment happy-dom
import type { MovementResponse } from '@pesly/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUE_STORE } from '../src/lib/local-store/database';
import {
  discardQueuedChange,
  readQueueCounts,
  readQueuedChange,
  readQueuedMovements,
  rejectQueuedMovement,
  removeQueuedMovement,
  retryQueuedChange,
  writeQueuedDelete,
  writeQueuedEdit,
  writeQueuedMovement,
} from '../src/lib/local-store/device-copy';
import {
  countQueue,
  discardQueued,
  enqueueMovement,
  loadQueue,
  markRejected,
  queueDelete,
  queueEdit,
  queuedToMovement,
  removeQueued,
  retryQueued,
  settleSent,
  type QueuedEditRequest,
  type QueuedRequest,
} from '../src/lib/local-store/queue';
import { openLocalStore } from '../src/lib/local-store/stores';
import { QUEUE_CHANGED_EVENT } from '../src/lib/sync/sync-events';

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
    expect(queue[0]).toMatchObject({
      operation: 'create',
      request: { type: 'expense', amount: '150050', id: id(1) },
    });
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

function serverExpense(n: number, overrides: Partial<MovementResponse> = {}): MovementResponse {
  return {
    id: id(n),
    type: 'expense',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    destinationAccountId: null,
    amount: '100000',
    destinationAmount: null,
    occurredAt: '2026-10-01T10:00:00.000Z',
    note: 'server note',
    rate: '13000000',
    rateSource: 'automatic',
    rateType: 'blue',
    tags: [],
    createdAt: '2026-10-01T10:00:01.000Z',
    ...overrides,
  };
}

type EditRate = Extract<QueuedEditRequest, { type: 'expense' }>['rate'];

function expenseEdit(amount: string, rate: EditRate = { source: 'keep' }) {
  return {
    type: 'expense',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    amount,
    occurredAt: '2026-10-01T10:00:00.000Z',
    note: 'edited',
    rate,
  } as QueuedEditRequest;
}

describe('queue of changes: edits and deletions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queues an edit of a cached movement as an update with its base and revision 1 (AC-01)', async () => {
    const store = await openLocalStore(ANA);

    expect(await queueEdit(store, serverExpense(1), expenseEdit('250000'), at(1))).toBe(true);

    const [record] = await loadQueue(store);
    expect(record).toMatchObject({
      id: id(1),
      operation: 'update',
      revision: 1,
      createdAt: at(1).toISOString(),
      base: { id: id(1), amount: '100000' },
      request: { type: 'expense', amount: '250000' },
    });
    store.close();
  });

  it('queues a delete of a cached movement (AC-01)', async () => {
    const store = await openLocalStore(ANA);

    expect(await queueDelete(store, serverExpense(1), at(1))).toBe(true);

    expect(await loadQueue(store)).toMatchObject([
      { id: id(1), operation: 'delete', revision: 1, base: { id: id(1) } },
    ]);
    store.close();
  });

  it('folds an edit into a queued create, which stays a create and keeps its rate when untouched (AC-01)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, expenseRequest(1), at(1));
    const shown = queuedToMovement((await loadQueue(store))[0] as never);

    expect(await queueEdit(store, shown, expenseEdit('999'), at(2))).toBe(true);

    const [record] = await loadQueue(store);
    expect(record).toMatchObject({
      operation: 'create',
      revision: 2,
      createdAt: at(1).toISOString(),
      request: { id: id(1), amount: '999', rate: { source: 'manual', value: '14000000' } },
    });
    store.close();
  });

  it('keeps one record for two edits, with the second request and revision 2 (AC-01)', async () => {
    const store = await openLocalStore(ANA);
    await queueEdit(
      store,
      serverExpense(1),
      expenseEdit('200', { source: 'manual', value: '15000000' }),
    );

    // The second form showed the queued manual rate untouched: the queued rate stays.
    await queueEdit(store, serverExpense(1), expenseEdit('300'));

    const queue = await loadQueue(store);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      operation: 'update',
      revision: 2,
      request: { amount: '300', rate: { source: 'manual', value: '15000000' } },
    });
    store.close();
  });

  it('turns a queued create or update into a single delete record (AC-01)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, expenseRequest(1), at(1));
    await queueEdit(store, serverExpense(2), expenseEdit('300'), at(2));

    await queueDelete(store, serverExpense(1), at(3));
    await queueDelete(store, serverExpense(2, { amount: '1' }), at(3));

    const queue = await loadQueue(store);
    expect(queue.map((item) => [item.id, item.operation, item.revision])).toEqual([
      [id(1), 'delete', 2],
      [id(2), 'delete', 2],
    ]);
    // The update kept the server movement it edited as the base of the delete.
    expect(queue[1]).toMatchObject({ base: { amount: '100000' }, createdAt: at(2).toISOString() });
    store.close();
  });

  it('refuses an edit of a queued delete and changes nothing (invalid input)', async () => {
    const store = await openLocalStore(ANA);
    await queueDelete(store, serverExpense(1), at(1));

    expect(await queueEdit(store, serverExpense(1), expenseEdit('300'), at(2))).toBe(false);

    expect(await loadQueue(store)).toMatchObject([{ operation: 'delete', revision: 1 }]);
    store.close();
  });

  it('refuses an edit whose type differs from the movement (invalid input)', async () => {
    const store = await openLocalStore(ANA);
    const transfer = {
      type: 'transfer',
      accountId: ACCOUNT,
      destinationAccountId: DESTINATION,
      amount: '5',
      occurredAt: '2026-10-01T10:00:00.000Z',
    } as QueuedEditRequest;

    expect(await queueEdit(store, serverExpense(1), transfer, at(1))).toBe(false);
    expect(await loadQueue(store)).toEqual([]);
    store.close();
  });

  it('clears the rejection when a failed change is edited (AC-05)', async () => {
    const store = await openLocalStore(ANA);
    await queueEdit(store, serverExpense(1), expenseEdit('300'), at(1));
    await markRejected(store, id(1), 'ACCOUNT_ARCHIVED', 1);

    await queueEdit(store, serverExpense(1), expenseEdit('400'), at(2));

    const [record] = await loadQueue(store);
    expect(record?.rejection).toBeUndefined();
    expect(record).toMatchObject({ revision: 2, request: { amount: '400' } });
    store.close();
  });

  it('removes a record settled with the sent revision and leaves one that changed since (FR-04)', async () => {
    const store = await openLocalStore(ANA);
    await queueEdit(store, serverExpense(1), expenseEdit('300'), at(1));
    await queueEdit(store, serverExpense(2), expenseEdit('300'), at(1));
    await queueEdit(store, serverExpense(2), expenseEdit('500'), at(2));

    await settleSent(store, id(1), 1);
    await settleSent(store, id(2), 1);

    expect(await loadQueue(store)).toMatchObject([{ id: id(2), revision: 2 }]);
    store.close();
  });

  it('turns a create changed while in flight into an update of the stored movement, automatic read as keep (FR-04)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(
      store,
      { ...expenseRequest(1), rate: { source: 'automatic' } } as QueuedRequest,
      at(1),
    );
    const shown = queuedToMovement((await loadQueue(store))[0] as never);
    await queueEdit(store, shown, expenseEdit('777'), at(2));
    const stored = serverExpense(1, { amount: '150050' });

    await settleSent(store, id(1), 1, stored);

    const [record] = await loadQueue(store);
    expect(record).toMatchObject({
      operation: 'update',
      revision: 2,
      base: stored,
      request: { amount: '777', rate: { source: 'keep' } },
    });
    expect(record?.operation === 'update' && 'id' in record.request).toBe(false);
    store.close();
  });

  it('does not flag a rejection of a revision that changed since (AC-05)', async () => {
    const store = await openLocalStore(ANA);
    await queueEdit(store, serverExpense(1), expenseEdit('300'), at(1));
    await queueEdit(store, serverExpense(1), expenseEdit('400'), at(2));

    await markRejected(store, id(1), 'ACCOUNT_ARCHIVED', 1);

    expect((await loadQueue(store))[0]?.rejection).toBeUndefined();
    store.close();
  });

  it('clears the flag on retry and removes the record on discard (AC-05)', async () => {
    const store = await openLocalStore(ANA);
    await queueEdit(store, serverExpense(1), expenseEdit('300'), at(1));
    await queueDelete(store, serverExpense(2), at(1));
    await markRejected(store, id(1), 'ACCOUNT_ARCHIVED', 1);
    await markRejected(store, id(2), 'INVALID', 1);

    expect(await retryQueued(store, id(1))).toBe(true);
    expect(await discardQueued(store, id(2))).toBe(true);
    expect(await retryQueued(store, id(99))).toBe(false);

    expect(await loadQueue(store)).toMatchObject([{ id: id(1), revision: 2 }]);
    expect((await loadQueue(store))[0]?.rejection).toBeUndefined();
    store.close();
  });

  it('counts pending and failed changes apart (AC-03)', async () => {
    const store = await openLocalStore(ANA);
    await enqueueMovement(store, expenseRequest(1), at(1));
    await queueEdit(store, serverExpense(2), expenseEdit('300'), at(2));
    await queueDelete(store, serverExpense(3), at(3));
    await markRejected(store, id(3), 'INVALID', 1);

    expect(await countQueue(store)).toEqual({ pending: 2, failed: 1 });
    store.close();
  });

  it('reads a record written by DISC-001-04b, with no operation and no revision, as a create (FR-07)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem(QUEUE_STORE, {
      id: id(1),
      request: expenseRequest(1),
      createdAt: at(1).toISOString(),
    });

    expect(await loadQueue(store)).toMatchObject([{ id: id(1), operation: 'create', revision: 0 }]);
    store.close();
  });

  it('skips and keeps a record whose base id differs from its own id (invalid input)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem(QUEUE_STORE, {
      id: id(1),
      operation: 'delete',
      base: serverExpense(2),
      createdAt: at(1).toISOString(),
      revision: 1,
    });

    expect(await loadQueue(store)).toEqual([]);
    expect(await store.getAll(QUEUE_STORE)).toHaveLength(1);
    store.close();
  });

  it('fires the queue-changed event once per successful helper write, and answers false on failure (AC-03)', async () => {
    const heard = vi.fn();
    window.addEventListener(QUEUE_CHANGED_EVENT, heard);

    expect(await writeQueuedMovement(ANA, expenseRequest(1))).toBe(true);
    expect(await writeQueuedEdit(ANA, serverExpense(2), expenseEdit('300'))).toBe(true);
    expect(await writeQueuedDelete(ANA, serverExpense(3))).toBe(true);
    await rejectQueuedMovement(ANA, id(3), 'INVALID');
    expect(await retryQueuedChange(ANA, id(3))).toBe(true);
    expect(await discardQueuedChange(ANA, id(3))).toBe(true);
    await removeQueuedMovement(ANA, id(1));
    expect(heard).toHaveBeenCalledTimes(7);

    expect(await readQueuedChange(ANA, id(2))).toMatchObject({ operation: 'update' });
    expect(await readQueuedChange(ANA, id(9))).toBeUndefined();
    expect(await readQueueCounts(ANA)).toEqual({ pending: 1, failed: 0 });

    heard.mockClear();
    expect(await writeQueuedEdit(undefined, serverExpense(2), expenseEdit('1'))).toBe(false);
    expect(await writeQueuedDelete(undefined, serverExpense(2))).toBe(false);
    expect(await readQueueCounts(undefined)).toEqual({ pending: 0, failed: 0 });
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener(QUEUE_CHANGED_EVENT, heard);
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
