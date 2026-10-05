// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiFailure, ApiResult } from '../src/lib/api-client';
import { enqueueMovement, loadQueue, type QueuedRequest } from '../src/lib/local-store/queue';
import { openLocalStore } from '../src/lib/local-store/stores';
import { SYNC_FINISHED_EVENT } from '../src/lib/sync/sync-events';
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

type FakeApi = Pick<ApiClient, 'createMovement'>;

function apiAnswering(answer: () => Promise<ApiResult<unknown>> = () => Promise.resolve(ok)) {
  const sent: (string | undefined)[] = [];
  const api: FakeApi = {
    createMovement: (body) => {
      sent.push(body.id);
      return answer() as ReturnType<ApiClient['createMovement']>;
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
