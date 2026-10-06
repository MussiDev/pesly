// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStoreUnavailable, QUEUE_STORE } from '../src/lib/local-store/database';
import { openLocalStore } from '../src/lib/local-store/stores';

const ANA = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  // A fresh in-memory IndexedDB per test, so no database outlives its test.
  globalThis.indexedDB = new IDBFactory();
});

function movement(id: string, occurredAt: string) {
  return { id, occurredAt };
}

describe('local store: one-key read and write', () => {
  it('reads and writes one key in one transaction, and deletes it on null (FR-04)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem(QUEUE_STORE, { id: 'k1', n: 1 });

    await store.updateItem(QUEUE_STORE, 'k1', (current) => ({
      ...(current as { id: string; n: number }),
      n: 2,
    }));
    expect(await store.get(QUEUE_STORE, 'k1')).toEqual({ id: 'k1', n: 2 });

    await store.updateItem(QUEUE_STORE, 'k1', () => undefined);
    expect(await store.get(QUEUE_STORE, 'k1')).toEqual({ id: 'k1', n: 2 });

    await store.updateItem(QUEUE_STORE, 'k1', () => null);
    expect(await store.get(QUEUE_STORE, 'k1')).toBeUndefined();
    store.close();
  });

  it('stores nothing when the change throws (invalid input)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem(QUEUE_STORE, { id: 'k1', n: 1 });

    await expect(
      store.updateItem(QUEUE_STORE, 'k1', () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');

    expect(await store.get(QUEUE_STORE, 'k1')).toEqual({ id: 'k1', n: 1 });
    store.close();
  });

  it('writes and removes one movement of the copy by its id (FR-04)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem('movements', movement('m1', '2026-10-01T10:00:00.000Z'));
    expect(await store.getAll('movements')).toHaveLength(1);

    await store.deleteItem('movements', 'm1');
    expect(await store.getAll('movements')).toEqual([]);
    store.close();
  });
});

describe('local store', () => {
  it('reads back a value written to the reference store after reopening the database (FR-01)', async () => {
    const first = await openLocalStore(ANA);
    await first.put('reference', 'accounts', [{ id: 'a1', name: 'Caja' }]);
    first.close();

    const second = await openLocalStore(ANA);

    expect(await second.get('reference', 'accounts')).toEqual([{ id: 'a1', name: 'Caja' }]);
    expect(await second.get('reference', 'tags')).toBeUndefined();
    second.close();
  });

  it('writes several reference values in one transaction (FR-01)', async () => {
    const store = await openLocalStore(ANA);

    await store.putMany('reference', [
      ['accounts', [1]],
      ['categories', [2]],
    ]);

    expect(await store.get('reference', 'accounts')).toEqual([1]);
    expect(await store.get('reference', 'categories')).toEqual([2]);
    store.close();
  });

  it('replaces the movements and lists them newest first by occurredAt (FR-02)', async () => {
    const store = await openLocalStore(ANA);
    await store.replaceAll('movements', [
      movement('old', '2026-09-01T10:00:00.000Z'),
      movement('mid', '2026-09-15T10:00:00.000Z'),
    ]);

    await store.replaceAll('movements', [
      movement('b', '2026-10-01T10:00:00.000Z'),
      movement('a', '2026-10-03T10:00:00.000Z'),
      movement('c', '2026-09-30T10:00:00.000Z'),
    ]);

    const newestFirst = await store.getAll('movements', { newestFirst: true });
    expect(newestFirst.map((item) => (item as { id: string }).id)).toEqual(['a', 'b', 'c']);
    store.close();
  });

  it('gives each user a separate database that the other cannot read (FR-01)', async () => {
    const ana = await openLocalStore(ANA);
    await ana.put('reference', 'accounts', ['ana']);
    ana.close();

    const bob = await openLocalStore(BOB);

    expect(await bob.get('reference', 'accounts')).toBeUndefined();
    bob.close();
    const names = (await indexedDB.databases()).map((database) => database.name);
    expect(names).toEqual(expect.arrayContaining([`pesly-${ANA}`, `pesly-${BOB}`]));
  });

  it('raises the LocalStoreUnavailable error when IndexedDB does not exist (FR-01)', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await expect(openLocalStore(ANA)).rejects.toBeInstanceOf(LocalStoreUnavailable);
  });

  it('rolls back a replaceAll that hits a write error and keeps the previous copy (FR-02)', async () => {
    const store = await openLocalStore(ANA);
    await store.replaceAll('movements', [movement('keep', '2026-10-01T10:00:00.000Z')]);

    // The second item has no `id`, the key of the store: the put fails mid-transaction.
    await expect(
      store.replaceAll('movements', [
        movement('new', '2026-10-02T10:00:00.000Z'),
        { occurredAt: '2026-10-03T10:00:00.000Z' },
      ]),
    ).rejects.toThrow();

    const left = await store.getAll('movements');
    expect(left).toEqual([movement('keep', '2026-10-01T10:00:00.000Z')]);
    store.close();
  });

  it('refuses an invalid user id and creates no database (FR-01)', async () => {
    for (const userId of ['', 'a b', '../x', 'x/y', 'x;drop']) {
      await expect(openLocalStore(userId), JSON.stringify(userId)).rejects.toBeInstanceOf(
        TypeError,
      );
    }

    expect(await indexedDB.databases()).toEqual([]);
  });

  it('clears a store (FR-02)', async () => {
    const store = await openLocalStore(ANA);
    await store.replaceAll('movements', [movement('a', '2026-10-01T10:00:00.000Z')]);

    await store.clear('movements');

    expect(await store.getAll('movements')).toEqual([]);
    store.close();
  });

  it('upgrades a version 1 database to 2 in place, keeping its data and adding an empty queue (FR-03)', async () => {
    // The database exactly as DISC-001-04a shipped it: version 1, two stores and the index.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(`pesly-${ANA}`, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const reference = database.createObjectStore('reference');
        reference.put([{ id: 'a1' }], 'accounts');
        const movements = database.createObjectStore('movements', { keyPath: 'id' });
        movements.createIndex('occurredAt', 'occurredAt');
        movements.put(movement('kept', '2026-10-01T10:00:00.000Z'));
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('could not create the version 1 database'));
      };
    });

    const store = await openLocalStore(ANA);

    expect(await store.get('reference', 'accounts')).toEqual([{ id: 'a1' }]);
    expect(await store.getAll('movements')).toEqual([movement('kept', '2026-10-01T10:00:00.000Z')]);
    expect(await store.getAll(QUEUE_STORE)).toEqual([]);
    store.close();
  });

  it('reads the queue ordered by createdAt, whatever the order it was written in (FR-03)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem(QUEUE_STORE, { id: 'c', createdAt: '2026-10-02T12:00:03.000Z' });
    await store.putItem(QUEUE_STORE, { id: 'a', createdAt: '2026-10-02T12:00:01.000Z' });
    await store.putItem(QUEUE_STORE, { id: 'b', createdAt: '2026-10-02T12:00:02.000Z' });

    const queue = await store.getAll(QUEUE_STORE);

    expect(queue.map((item) => (item as { id: string }).id)).toEqual(['a', 'b', 'c']);
    store.close();
  });

  it('deletes one queued item by its key and leaves the rest (FR-03)', async () => {
    const store = await openLocalStore(ANA);
    await store.putItem(QUEUE_STORE, { id: 'a', createdAt: '2026-10-02T12:00:01.000Z' });
    await store.putItem(QUEUE_STORE, { id: 'b', createdAt: '2026-10-02T12:00:02.000Z' });

    await store.deleteItem(QUEUE_STORE, 'a');
    await store.deleteItem(QUEUE_STORE, 'missing');

    expect(await store.getAll(QUEUE_STORE)).toEqual([
      { id: 'b', createdAt: '2026-10-02T12:00:02.000Z' },
    ]);
    store.close();
  });

  it('refuses an item with no key and stores nothing (invalid input)', async () => {
    const store = await openLocalStore(ANA);

    await expect(
      store.putItem(QUEUE_STORE, { createdAt: '2026-10-02T12:00:01.000Z' }),
    ).rejects.toThrow();

    expect(await store.getAll(QUEUE_STORE)).toEqual([]);
    store.close();
  });

  it('closes its connection when another tab asks for a newer version, so the upgrade is never blocked (FR-03)', async () => {
    const store = await openLocalStore(ANA);

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(`pesly-${ANA}`, 3);
      request.onupgradeneeded = () => undefined;
      request.onblocked = () => {
        reject(new Error('the upgrade was blocked by an open connection'));
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('could not open the newer version'));
      };
    });

    store.close();
  });
});
