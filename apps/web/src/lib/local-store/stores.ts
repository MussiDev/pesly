import type { REFERENCE_STORE } from './database';
import {
  MOVEMENTS_STORE,
  OCCURRED_AT_INDEX,
  QUEUE_CREATED_AT_INDEX,
  QUEUE_STORE,
  openLocalDatabase,
  type StoreName,
} from './database';

/**
 * Typed access to the object stores of one user. Values are `unknown` on purpose: whoever reads
 * them parses them with the shared contracts, so a record that does not fit is never trusted.
 */
export interface LocalStore {
  get(store: StoreName, key: string): Promise<unknown>;
  /**
   * Every item of a store; `newestFirst` orders the movements by `occurredAt`, newest first, and the
   * queue always comes oldest first by `createdAt`.
   */
  getAll(store: StoreName, options?: { newestFirst?: boolean }): Promise<unknown[]>;
  put(store: typeof REFERENCE_STORE, key: string, value: unknown): Promise<void>;
  /** Several reference values in one transaction: either all of them are written or none. */
  putMany(
    store: typeof REFERENCE_STORE,
    entries: readonly (readonly [string, unknown])[],
  ): Promise<void>;
  /** Clears the store and writes the items in one transaction; a failed write keeps the old copy. */
  replaceAll(store: typeof MOVEMENTS_STORE, items: readonly unknown[]): Promise<void>;
  /** Writes one queued item under its own `id`; an item with no `id` is refused and nothing is stored. */
  putItem(store: typeof QUEUE_STORE, value: unknown): Promise<void>;
  /** Removes one queued item by its key; a key that is not there is not an error. */
  deleteItem(store: typeof QUEUE_STORE, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
  close(): void;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** Runs `work` in one transaction and settles when the transaction commits or aborts. */
function inTransaction(
  database: IDBDatabase,
  store: StoreName,
  work: (objectStore: IDBObjectStore) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
    try {
      work(transaction.objectStore(store));
    } catch (error) {
      // A synchronous failure (a missing key, a value that cannot be cloned) rolls everything back.
      transaction.abort();
      reject(error instanceof Error ? error : new Error('IndexedDB write failed'));
    }
  });
}

export async function openLocalStore(userId: string): Promise<LocalStore> {
  const database = await openLocalDatabase(userId);

  return {
    get: (store, key) =>
      requestResult(database.transaction(store, 'readonly').objectStore(store).get(key)),

    async getAll(store, options = {}) {
      const objectStore = database.transaction(store, 'readonly').objectStore(store);
      const ordered =
        store === QUEUE_STORE
          ? { index: QUEUE_CREATED_AT_INDEX, direction: 'next' as const }
          : store === MOVEMENTS_STORE && options.newestFirst
            ? { index: OCCURRED_AT_INDEX, direction: 'prev' as const }
            : undefined;
      if (ordered === undefined) return requestResult(objectStore.getAll());
      return new Promise<unknown[]>((resolve, reject) => {
        const items: unknown[] = [];
        const cursor = objectStore.index(ordered.index).openCursor(null, ordered.direction);
        cursor.onsuccess = () => {
          const position = cursor.result;
          if (position === null) {
            resolve(items);
            return;
          }
          items.push(position.value);
          position.continue();
        };
        cursor.onerror = () => {
          reject(cursor.error ?? new Error('IndexedDB cursor failed'));
        };
      });
    },

    put: (store, key, value) =>
      inTransaction(database, store, (objectStore) => {
        objectStore.put(value, key);
      }),

    putMany: (store, entries) =>
      inTransaction(database, store, (objectStore) => {
        for (const [key, value] of entries) objectStore.put(value, key);
      }),

    replaceAll: (store, items) =>
      inTransaction(database, store, (objectStore) => {
        objectStore.clear();
        for (const item of items) objectStore.put(item);
      }),

    putItem: (store, value) =>
      inTransaction(database, store, (objectStore) => {
        objectStore.put(value);
      }),

    deleteItem: (store, key) =>
      inTransaction(database, store, (objectStore) => {
        objectStore.delete(key);
      }),

    clear: (store) =>
      inTransaction(database, store, (objectStore) => {
        objectStore.clear();
      }),

    close: () => {
      database.close();
    },
  };
}
