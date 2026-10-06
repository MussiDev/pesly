// @vitest-environment happy-dom
import type { MovementResponse } from '@pesly/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiFailure, ApiResult } from '../src/lib/api-client';
import { MOVEMENTS_STORE } from '../src/lib/local-store/database';
import {
  enqueueMovement,
  loadQueue,
  queueDelete,
  queueEdit,
  type QueuedEditRequest,
  type QueuedRequest,
} from '../src/lib/local-store/queue';
import { openLocalStore } from '../src/lib/local-store/stores';
import { QUEUE_CHANGED_EVENT, SYNC_FINISHED_EVENT } from '../src/lib/sync/sync-events';
import { cancelSyncRetry, syncMovementQueue } from '../src/lib/sync/sync-queue';

const ANA = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '00000000-0000-4000-8000-000000000900';
const CATEGORY = '00000000-0000-4000-8000-000000000901';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function request(n: number): QueuedRequest {
  return {
    id: id(n),
    type: 'expense',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    amount: '150050',
    occurredAt: '2026-10-02T15:30:00.000Z',
    rate: { source: 'manual', value: '14000000' },
  };
}

const ok: ApiResult<unknown> = { ok: true, data: {} };

function failure(code: ApiFailure['code'], retryAfterSeconds?: number): ApiFailure {
  return {
    ok: false,
    code,
    messageKey: code === 'NETWORK' ? 'network' : 'unexpected',
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

type FakeApi = Pick<ApiClient, 'createMovement' | 'updateMovement' | 'deleteMovement'>;

function apiAnswering(answer: () => Promise<ApiResult<unknown>> = () => Promise.resolve(ok)) {
  const sent: (string | undefined)[] = [];
  const api: FakeApi = {
    createMovement: (body) => {
      sent.push(body.id);
      return answer() as ReturnType<ApiClient['createMovement']>;
    },
    updateMovement: (movementId) => {
      sent.push(movementId);
      return answer() as ReturnType<ApiClient['updateMovement']>;
    },
    deleteMovement: (movementId) => {
      sent.push(movementId);
      return answer() as ReturnType<ApiClient['deleteMovement']>;
    },
  };
  return { api, sent };
}

async function queueOf(...numbers: number[]): Promise<void> {
  const store = await openLocalStore(ANA);
  for (const n of numbers)
    await enqueueMovement(store, request(n), new Date(Date.UTC(2026, 9, 2, 12, 0, n)));
  store.close();
}

async function remaining(): Promise<string[]> {
  const store = await openLocalStore(ANA);
  const items = await loadQueue(store);
  store.close();
  return items.map((item) => item.id);
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

/** A minimal `navigator.locks` that honors `ifAvailable`, to see the lock name and the refusal. */
function installLocks() {
  const held = new Set<string>();
  const names: string[] = [];
  const locks = {
    request: vi.fn(
      async (
        name: string,
        options: { ifAvailable?: boolean },
        callback: (lock: { name: string } | null) => Promise<unknown>,
      ) => {
        names.push(name);
        if (options.ifAvailable === true && held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name });
        } finally {
          held.delete(name);
        }
      },
    ),
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  return { locks, names };
}

function removeLocks(): void {
  Reflect.deleteProperty(navigator, 'locks');
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  removeLocks();
});

afterEach(() => {
  cancelSyncRetry();
  vi.useRealTimers();
  setOnline(true);
  removeLocks();
});

describe('syncMovementQueue', () => {
  it('sends every queued movement and leaves the queue empty (AC-05)', async () => {
    await queueOf(1, 2, 3);
    const { api, sent } = apiAnswering();

    const outcome = await syncMovementQueue(ANA, api);

    expect(outcome).toEqual({ sent: 3, rejected: 0 });
    expect(sent.sort()).toEqual([id(1), id(2), id(3)]);
    expect(await remaining()).toEqual([]);
  });

  it('does nothing for an empty queue (AC-05)', async () => {
    const { api, sent } = apiAnswering();

    expect(await syncMovementQueue(ANA, api)).toEqual({ sent: 0, rejected: 0 });
    expect(sent).toEqual([]);
  });

  it('keeps a movement the server refused, flagged with its code, and sends the rest (FR-04)', async () => {
    await queueOf(1, 2);
    const { api } = apiAnswering();
    let calls = 0;
    const refusing: FakeApi = {
      ...api,
      createMovement: (body) => {
        calls += 1;
        return (
          body.id === id(1) ? Promise.resolve(failure('ACCOUNT_ARCHIVED')) : Promise.resolve(ok)
        ) as ReturnType<ApiClient['createMovement']>;
      },
    };

    await syncMovementQueue(ANA, refusing);
    await syncMovementQueue(ANA, api);

    expect(await remaining()).toEqual([id(1)]);
    const store = await openLocalStore(ANA);
    expect((await loadQueue(store))[0]?.rejection).toEqual({ code: 'ACCOUNT_ARCHIVED' });
    store.close();
    expect(calls).toBe(2);
  });

  it('does nothing while a second pass runs for the same user: the lock is taken (FR-05)', async () => {
    await queueOf(1, 2);
    const { names } = installLocks();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api, sent } = apiAnswering(async () => {
      await gate;
      return ok;
    });

    const first = syncMovementQueue(ANA, api);
    await vi.waitFor(() => {
      expect(sent.length).toBeGreaterThan(0);
    });
    const second = await syncMovementQueue(ANA, api);
    release();
    const outcome = await first;

    expect(second).toBeUndefined();
    expect(outcome).toEqual({ sent: 2, rejected: 0 });
    expect(sent.sort()).toEqual([id(1), id(2)]);
    expect(names).toEqual([`pesly-sync-${ANA}`, `pesly-sync-${ANA}`]);
  });

  it('gives the same result with the in-memory guard when there is no Web Locks (FR-05)', async () => {
    await queueOf(1, 2);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api, sent } = apiAnswering(async () => {
      await gate;
      return ok;
    });

    const first = syncMovementQueue(ANA, api);
    await vi.waitFor(() => {
      expect(sent.length).toBeGreaterThan(0);
    });
    const second = await syncMovementQueue(ANA, api);
    release();
    const outcome = await first;

    expect(second).toBeUndefined();
    expect(outcome).toEqual({ sent: 2, rejected: 0 });
    // The guard is released: a later pass runs again.
    await queueOf(3);
    expect(await syncMovementQueue(ANA, apiAnswering().api)).toEqual({ sent: 1, rejected: 0 });
  });

  it('fires the finished event once when something was sent and never when nothing was (FR-04)', async () => {
    const finished = vi.fn();
    window.addEventListener(SYNC_FINISHED_EVENT, finished);
    try {
      await syncMovementQueue(ANA, apiAnswering().api);
      expect(finished).not.toHaveBeenCalled();

      await queueOf(1, 2);
      await syncMovementQueue(ANA, apiAnswering().api);
      expect(finished).toHaveBeenCalledTimes(1);

      await queueOf(3);
      await syncMovementQueue(ANA, apiAnswering(() => Promise.resolve(failure('NETWORK'))).api);
      expect(finished).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SYNC_FINISHED_EVENT, finished);
    }
  });

  it('schedules one retry after the seconds of a rate limit, and cancelling stops it (FR-04)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await queueOf(1);
    let limited = true;
    const { api, sent } = apiAnswering(() =>
      Promise.resolve(limited ? failure('RATE_LIMITED', 30) : ok),
    );

    const first = await syncMovementQueue(ANA, api);
    expect(first).toMatchObject({ stopped: 'rate-limited', retryAfterSeconds: 30 });
    expect(sent).toHaveLength(1);

    limited = false;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(await remaining()).toEqual([]);

    // A new limit, then cancelled: the timer never fires.
    await queueOf(2);
    limited = true;
    await syncMovementQueue(ANA, api);
    expect(sent).toHaveLength(3);
    cancelSyncRetry();
    limited = false;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent).toHaveLength(3);
  });

  it('never runs a pass while the browser reports it is offline (invalid input)', async () => {
    await queueOf(1);
    setOnline(false);
    const { api, sent } = apiAnswering();

    expect(await syncMovementQueue(ANA, api)).toBeUndefined();

    expect(sent).toEqual([]);
    expect(await remaining()).toEqual([id(1)]);
  });

  it('leaves the queue intact when the request throws or IndexedDB is missing (invalid input)', async () => {
    await queueOf(1);
    const throwing: FakeApi = {
      ...apiAnswering().api,
      createMovement: () => {
        throw new Error('boom');
      },
    };

    await expect(syncMovementQueue(ANA, throwing)).resolves.toMatchObject({ stopped: 'offline' });
    expect(await remaining()).toEqual([id(1)]);

    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await expect(syncMovementQueue(ANA, apiAnswering().api)).resolves.toBeUndefined();
  });
});

function server(n: number, overrides: Partial<MovementResponse> = {}): MovementResponse {
  return {
    id: id(n),
    type: 'expense',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    destinationAccountId: null,
    amount: '100000',
    destinationAmount: null,
    occurredAt: '2026-10-01T10:00:00.000Z',
    note: null,
    rate: '13000000',
    rateSource: 'automatic',
    rateType: 'blue',
    tags: [],
    createdAt: '2026-10-01T10:00:01.000Z',
    ...overrides,
  };
}

function edit(amount: string): QueuedEditRequest {
  return {
    type: 'expense',
    accountId: ACCOUNT,
    categoryId: CATEGORY,
    amount,
    occurredAt: '2026-10-01T10:00:00.000Z',
    rate: { source: 'keep' },
  };
}

async function withStore<T>(
  work: (store: Awaited<ReturnType<typeof openLocalStore>>) => Promise<T>,
): Promise<T> {
  const store = await openLocalStore(ANA);
  try {
    return await work(store);
  } finally {
    store.close();
  }
}

/** A server that keeps whatever it receives last, like `PUT /movements/:id` does. */
function lastWriteWinsServer() {
  const rows = new Map<string, MovementResponse>();
  const calls: string[] = [];
  const api: FakeApi = {
    createMovement: (body) => {
      calls.push(`POST ${String(body.id)}`);
      return Promise.resolve({ ok: true, data: server(0) });
    },
    updateMovement: (movementId, body) => {
      calls.push(`PUT ${movementId}`);
      const stored = server(0, { id: movementId, amount: body.amount });
      rows.set(movementId, stored);
      return Promise.resolve({ ok: true, data: stored });
    },
    deleteMovement: (movementId) => {
      calls.push(`DELETE ${movementId}`);
      const existed = rows.delete(movementId);
      return Promise.resolve(existed ? { ok: true, data: undefined } : failure('NOT_FOUND'));
    },
  };
  return { api, rows, calls };
}

describe('syncMovementQueue with edits and deletions (DISC-001-04c)', () => {
  it('sends a queued edit with PUT and a queued delete with DELETE, and removes both (AC-07)', async () => {
    await withStore(async (store) => {
      await queueEdit(store, server(1), edit('250000'));
      await queueDelete(store, server(2));
    });
    const fake = lastWriteWinsServer();
    fake.rows.set(id(2), server(2));

    const outcome = await syncMovementQueue(ANA, fake.api);

    expect(outcome).toEqual({ sent: 2, rejected: 0 });
    expect(fake.calls.sort()).toEqual([`DELETE ${id(2)}`, `PUT ${id(1)}`]);
    expect(await remaining()).toEqual([]);
  });

  it('settles a delete the server answers 404 as done (FR-04)', async () => {
    await withStore((store) => queueDelete(store, server(1)));

    expect(await syncMovementQueue(ANA, lastWriteWinsServer().api)).toEqual({
      sent: 1,
      rejected: 0,
    });
    expect(await remaining()).toEqual([]);
  });

  it('flags an edit the server answers 404 or refuses on validation, with the code (AC-05)', async () => {
    await withStore(async (store) => {
      await queueEdit(store, server(1), edit('1'));
      await queueEdit(store, server(2), edit('2'));
    });
    const refusing: FakeApi = {
      ...apiAnswering().api,
      updateMovement: (movementId) =>
        Promise.resolve(failure(movementId === id(1) ? 'NOT_FOUND' : 'ACCOUNT_ARCHIVED')),
    };

    expect(await syncMovementQueue(ANA, refusing)).toEqual({ sent: 0, rejected: 2 });

    const queue = await withStore((store) => loadQueue(store));
    expect(queue.map((item) => [item.id, item.rejection?.code])).toEqual([
      [id(1), 'NOT_FOUND'],
      [id(2), 'ACCOUNT_ARCHIVED'],
    ]);
  });

  it('keeps a record edited while its request was in flight, and the next pass sends the new version (FR-04)', async () => {
    await withStore((store) => queueEdit(store, server(1), edit('100')));
    const bodies: string[] = [];
    let editWhileSending = true;
    const api: FakeApi = {
      ...apiAnswering().api,
      updateMovement: async (movementId, body) => {
        bodies.push(body.amount);
        if (editWhileSending) {
          editWhileSending = false;
          await withStore((store) => queueEdit(store, server(1), edit('200')));
        }
        return { ok: true, data: server(1, { id: movementId, amount: body.amount }) };
      },
    };

    await syncMovementQueue(ANA, api);
    expect(await remaining()).toEqual([id(1)]);
    await syncMovementQueue(ANA, api);

    expect(bodies).toEqual(['100', '200']);
    expect(await remaining()).toEqual([]);
  });

  it('keeps the edit received last when two devices edit one movement, and each copy holds the answer it got (AC-04)', async () => {
    const fake = lastWriteWinsServer();
    const deviceA = new IDBFactory();
    const deviceB = new IDBFactory();
    const onDevice = async <T>(device: IDBFactory, work: () => Promise<T>): Promise<T> => {
      globalThis.indexedDB = device;
      return work();
    };
    const copyOf = () =>
      withStore((store) => store.get(MOVEMENTS_STORE, id(1))) as Promise<
        MovementResponse | undefined
      >;

    await onDevice(deviceA, () => withStore((store) => queueEdit(store, server(1), edit('111'))));
    await onDevice(deviceB, () => withStore((store) => queueEdit(store, server(1), edit('222'))));
    await onDevice(deviceA, () => syncMovementQueue(ANA, fake.api));
    await onDevice(deviceB, () => syncMovementQueue(ANA, fake.api));

    expect(fake.rows.get(id(1))?.amount).toBe('222');
    expect((await onDevice(deviceB, copyOf))?.amount).toBe('222');
    expect((await onDevice(deviceA, copyOf))?.amount).toBe('111');
    expect(await onDevice(deviceA, remaining)).toEqual([]);
    expect(await onDevice(deviceB, remaining)).toEqual([]);
  });

  it('writes the answer of a sent edit into the device copy and removes a sent delete from it (AC-04)', async () => {
    await withStore(async (store) => {
      await store.putItem(MOVEMENTS_STORE, server(2));
      await queueEdit(store, server(1), edit('555'));
      await queueDelete(store, server(2));
    });
    const fake = lastWriteWinsServer();
    fake.rows.set(id(2), server(2));

    await syncMovementQueue(ANA, fake.api);

    const copy = await withStore((store) => store.getAll(MOVEMENTS_STORE));
    expect(copy).toEqual([server(0, { id: id(1), amount: '555' })]);
  });

  it('fires the queue-changed event after a pass that settled or flagged something (AC-03)', async () => {
    const heard = vi.fn();
    window.addEventListener(QUEUE_CHANGED_EVENT, heard);
    try {
      await syncMovementQueue(ANA, apiAnswering().api);
      expect(heard).not.toHaveBeenCalled();

      await withStore((store) => queueDelete(store, server(1)));
      heard.mockClear();
      await syncMovementQueue(ANA, lastWriteWinsServer().api);
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(QUEUE_CHANGED_EVENT, heard);
    }
  });
});

describe('syncMovementQueue retrying with backoff (DISC-001-04c)', () => {
  async function expectNextAttemptAfter(seconds: number, sent: unknown[]): Promise<void> {
    const before = sent.length;
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
    expect(sent).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(sent).toHaveLength(before + 1);
    });
  }

  it('keeps a change pending after a network or server error and sends it on the retry (AC-06)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await withStore((store) => queueEdit(store, server(1), edit('9')));
    const answers = [failure('NETWORK'), failure('INTERNAL'), ok];
    const { api, sent } = apiAnswering(() => Promise.resolve(answers.shift() ?? ok));

    expect(await syncMovementQueue(ANA, api)).toMatchObject({ stopped: 'offline' });
    expect(await remaining()).toEqual([id(1)]);
    await expectNextAttemptAfter(5, sent);
    await expectNextAttemptAfter(10, sent);

    await vi.waitFor(async () => {
      expect(await remaining()).toEqual([]);
    });
  });

  it('waits 5, 10, 20, 40, 80, 160, 300 and 300 s, and a pass that completes starts over at 5 s (NFR-01)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await withStore((store) => queueEdit(store, server(1), edit('9')));
    let failing = true;
    const { api, sent } = apiAnswering(() => Promise.resolve(failing ? failure('INTERNAL') : ok));

    await syncMovementQueue(ANA, api);
    for (const seconds of [5, 10, 20, 40, 80, 160, 300, 300]) {
      await expectNextAttemptAfter(seconds, sent);
    }
    failing = false;
    await expectNextAttemptAfter(300, sent);
    await vi.waitFor(async () => {
      expect(await remaining()).toEqual([]);
    });

    failing = true;
    await withStore((store) => queueEdit(store, server(2), edit('9')));
    await syncMovementQueue(ANA, api);
    await expectNextAttemptAfter(5, sent);
  });

  it('schedules nothing while the browser is offline, nor after the session was refused (FR-06)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await withStore((store) => queueEdit(store, server(1), edit('9')));
    const goesOffline = apiAnswering(() => {
      setOnline(false);
      return Promise.resolve(failure('NETWORK'));
    });

    await syncMovementQueue(ANA, goesOffline.api);
    setOnline(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(goesOffline.sent).toHaveLength(1);

    const refused = apiAnswering(() => Promise.resolve(failure('UNAUTHENTICATED')));
    expect(await syncMovementQueue(ANA, refused.api)).toMatchObject({ stopped: 'unauthenticated' });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refused.sent).toHaveLength(1);
  });
});
