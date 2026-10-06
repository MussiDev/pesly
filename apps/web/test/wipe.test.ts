// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOVEMENTS_STORE, QUEUE_STORE, REFERENCE_STORE } from '../src/lib/local-store/database';
import {
  SESSION_POINTER_KEY,
  readSessionPointer,
  writeSessionPointer,
} from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { USER_ID_PATTERN } from '../src/lib/local-store/user-id';
import { resumePendingWipes, wipeLocalData } from '../src/lib/local-store/wipe';
import {
  WIPE_MARKER_KEY,
  addToWipeMarker,
  isWipePending,
  readWipeMarker,
  removeFromWipeMarker,
} from '../src/lib/local-store/wipe-marker';

const ANA = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  // A fresh in-memory IndexedDB per test, so no database outlives its test.
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

async function seed(userId: string): Promise<void> {
  const store = await openLocalStore(userId);
  await store.put(REFERENCE_STORE, 'accounts', [{ id: 'a1' }]);
  await store.putItem(MOVEMENTS_STORE, { id: 'm1', occurredAt: '2026-10-01T10:00:00.000Z' });
  await store.putItem(QUEUE_STORE, { id: 'q1', createdAt: '2026-10-02T10:00:00.000Z' });
  store.close();
}

async function databaseNames(): Promise<(string | undefined)[]> {
  return (await indexedDB.databases()).map((database) => database.name);
}

function blockStorage(): void {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
  }
}

describe('user id rule', () => {
  it('accepts letters, digits and hyphens only (invalid input)', () => {
    expect(USER_ID_PATTERN.test(ANA)).toBe(true);
    for (const userId of ['', 'a b', '../x', 'x/y', 'x;drop']) {
      expect(USER_ID_PATTERN.test(userId), JSON.stringify(userId)).toBe(false);
    }
  });
});

describe('wipeLocalData', () => {
  it("deletes the user's database: queue, reference copy and recent movements are gone (AC-04)", async () => {
    await seed(ANA);
    expect(await databaseNames()).toContain(`pesly-${ANA}`);

    await expect(wipeLocalData(ANA)).resolves.toBe('deleted');

    expect(await databaseNames()).not.toContain(`pesly-${ANA}`);
  });

  it('clears the session pointer and adds the id to the marker (AC-04)', async () => {
    await seed(ANA);
    writeSessionPointer({ userId: ANA, emailVerified: true });

    await wipeLocalData(ANA);

    expect(readSessionPointer()).toBeNull();
    expect(localStorage.getItem(SESSION_POINTER_KEY)).toBeNull();
    expect(readWipeMarker()).toEqual([ANA]);
    expect(isWipePending(ANA)).toBe(true);
  });

  it("leaves another user's database untouched (AC-02)", async () => {
    await seed(ANA);
    await seed(BOB);

    await wipeLocalData(ANA);

    expect(await databaseNames()).toEqual([`pesly-${BOB}`]);
    expect(isWipePending(BOB)).toBe(false);
    const bob = await openLocalStore(BOB);
    expect(await bob.get(REFERENCE_STORE, 'accounts')).toEqual([{ id: 'a1' }]);
    expect(await bob.getAll(MOVEMENTS_STORE)).toHaveLength(1);
    expect(await bob.getAll(QUEUE_STORE)).toHaveLength(1);
    bob.close();
  });

  it('error: without IndexedDB the wipe answers unavailable and keeps the marker', async () => {
    writeSessionPointer({ userId: ANA, emailVerified: true });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await expect(wipeLocalData(ANA)).resolves.toBe('unavailable');

    expect(readWipeMarker()).toEqual([ANA]);
    expect(readSessionPointer()).toBeNull();
  });

  it('error: a deletion request that fails answers unavailable and keeps the marker', async () => {
    await seed(ANA);
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
      const request = { onerror: null } as unknown as IDBOpenDBRequest;
      setTimeout(() => {
        const onerror = request.onerror as ((event: Event) => void) | null;
        onerror?.(new Event('error'));
      }, 0);
      return request;
    });

    await expect(wipeLocalData(ANA)).resolves.toBe('unavailable');

    expect(readWipeMarker()).toEqual([ANA]);
  });

  it('error: a deletion request that throws answers unavailable and keeps the marker', async () => {
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
      throw new DOMException('refused', 'SecurityError');
    });

    await expect(wipeLocalData(ANA)).resolves.toBe('unavailable');

    expect(readWipeMarker()).toEqual([ANA]);
  });

  it('error: a deletion blocked by an open connection answers pending and completes once that connection closes on versionchange', async () => {
    await seed(ANA);
    // A connection of another tab that only closes a moment after it hears the versionchange.
    const other = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`pesly-${ANA}`);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('could not open'));
      };
    });
    other.onversionchange = () => {
      setTimeout(() => {
        other.close();
      }, 20);
    };

    await expect(wipeLocalData(ANA)).resolves.toBe('pending');

    expect(readWipeMarker()).toEqual([ANA]);
    await vi.waitFor(async () => {
      expect(await databaseNames()).not.toContain(`pesly-${ANA}`);
    });
  });

  it('error: with blocked localStorage the database is still deleted and nothing throws', async () => {
    await seed(ANA);
    blockStorage();

    await expect(wipeLocalData(ANA)).resolves.toBe('deleted');

    expect(await databaseNames()).not.toContain(`pesly-${ANA}`);
  });

  it('error: an invalid user id answers unavailable and touches nothing (invalid input)', async () => {
    await seed(ANA);
    writeSessionPointer({ userId: ANA, emailVerified: true });
    const deleteDatabase = vi.spyOn(indexedDB, 'deleteDatabase');

    for (const userId of ['', 'a b', '../x', 'x/y', 'x;drop']) {
      await expect(wipeLocalData(userId), JSON.stringify(userId)).resolves.toBe('unavailable');
    }

    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem(WIPE_MARKER_KEY)).toBeNull();
    expect(readSessionPointer()).toEqual({ userId: ANA, emailVerified: true });
    expect(await databaseNames()).toEqual([`pesly-${ANA}`]);
  });
});

describe('resumePendingWipes', () => {
  it('deletes a database left by an interrupted wipe and leaves the marker (AC-04)', async () => {
    await seed(ANA);
    await seed(BOB);
    addToWipeMarker(ANA);

    await resumePendingWipes();

    expect(await databaseNames()).toEqual([`pesly-${BOB}`]);
    expect(readWipeMarker()).toEqual([ANA]);
  });

  it('error: never throws, without IndexedDB or with blocked localStorage', async () => {
    addToWipeMarker(ANA);
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await expect(resumePendingWipes()).resolves.toBeUndefined();

    globalThis.indexedDB = new IDBFactory();
    blockStorage();
    await expect(resumePendingWipes()).resolves.toBeUndefined();
  });
});

describe('wipe marker', () => {
  it('adds, checks and removes ids (AC-04)', () => {
    expect(readWipeMarker()).toEqual([]);
    expect(isWipePending(ANA)).toBe(false);

    addToWipeMarker(ANA);
    addToWipeMarker(BOB);
    expect(readWipeMarker()).toEqual([ANA, BOB]);
    expect(isWipePending(ANA)).toBe(true);

    removeFromWipeMarker(ANA);
    expect(readWipeMarker()).toEqual([BOB]);
    expect(isWipePending(ANA)).toBe(false);
    removeFromWipeMarker('missing');
    expect(readWipeMarker()).toEqual([BOB]);
  });

  it('error: a marker that is not JSON or holds an invalid id reads as empty (invalid input)', async () => {
    for (const raw of ['not json', '{}', 'null', '"x"', '["../x"]', '[5]', '[null]']) {
      localStorage.setItem(WIPE_MARKER_KEY, raw);
      expect(readWipeMarker(), raw).toEqual([]);
      expect(isWipePending('../x'), raw).toBe(false);
    }

    localStorage.setItem(WIPE_MARKER_KEY, JSON.stringify(['../x', ANA, 7, 'a b']));
    expect(readWipeMarker()).toEqual([ANA]);

    // The invalid entries never name a database to delete.
    await seed(BOB);
    const deleteDatabase = vi.spyOn(indexedDB, 'deleteDatabase');
    await resumePendingWipes();
    expect(deleteDatabase).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith(`pesly-${ANA}`);
    expect(await databaseNames()).toEqual([`pesly-${BOB}`]);
  });

  it('refuses to add an invalid id (invalid input)', () => {
    addToWipeMarker('../x');
    expect(localStorage.getItem(WIPE_MARKER_KEY)).toBeNull();
  });

  it('keeps at most 20 ids, without duplicates, dropping the oldest (invalid input)', () => {
    for (let index = 1; index <= 25; index += 1) addToWipeMarker(`user-${String(index)}`);
    addToWipeMarker('user-25');
    addToWipeMarker('user-10');

    const marker = readWipeMarker();
    expect(marker).toHaveLength(20);
    expect(new Set(marker).size).toBe(20);
    expect(marker[0]).toBe('user-6');
    expect(marker[19]).toBe('user-25');
  });

  it('error: blocked localStorage reads as an empty marker and writes nothing, without an error', () => {
    blockStorage();

    expect(readWipeMarker()).toEqual([]);
    expect(isWipePending(ANA)).toBe(false);
    expect(() => {
      addToWipeMarker(ANA);
      removeFromWipeMarker(ANA);
    }).not.toThrow();
  });
});
