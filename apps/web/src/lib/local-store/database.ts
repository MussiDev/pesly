import { USER_ID_PATTERN } from './user-id';
import { isWipePending } from './wipe-marker';

/**
 * Version 1 had the two object stores and the index the list needs; version 2 adds the queue of
 * movements saved without a connection. The upgrade keeps everything that version 1 stored.
 */
export const DATABASE_VERSION = 2;

/** Out-of-line keys such as `accounts` or `tags`: one value per kind of reference data. */
export const REFERENCE_STORE = 'reference';
/** The recent movements, keyed by their `id` and indexed by `occurredAt`. */
export const MOVEMENTS_STORE = 'movements';
export const OCCURRED_AT_INDEX = 'occurredAt';
/**
 * Movements saved on the device and not yet sent, keyed by their `id` and indexed by `createdAt`.
 * Apart from `movements` on purpose: that store is a cache that every online load replaces.
 */
export const QUEUE_STORE = 'queue';
export const QUEUE_CREATED_AT_INDEX = 'createdAt';

export type StoreName = typeof REFERENCE_STORE | typeof MOVEMENTS_STORE | typeof QUEUE_STORE;

/** IndexedDB is missing or refused to open (a private window, an old browser, a blocked upgrade). */
export class LocalStoreUnavailable extends Error {
  constructor(message = 'The local store is not available', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LocalStoreUnavailable';
  }
}

/** One database per user: the id is part of the name, so it can only be letters, digits and hyphens. */
export function databaseNameFor(userId: string): string {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new TypeError('The user id is not valid for a database name');
  }
  return `pesly-${userId}`;
}

export async function openLocalDatabase(userId: string): Promise<IDBDatabase> {
  const name = databaseNameFor(userId);
  // Opening would recreate a database whose wipe has not been confirmed (a late writer, another tab).
  if (isWipePending(userId)) {
    throw new LocalStoreUnavailable('A wipe of the local store is pending');
  }
  const factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB;
  if (factory === undefined) throw new LocalStoreUnavailable();

  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DATABASE_VERSION);
    } catch (error) {
      reject(new LocalStoreUnavailable(undefined, { cause: error }));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REFERENCE_STORE)) {
        database.createObjectStore(REFERENCE_STORE);
      }
      if (!database.objectStoreNames.contains(MOVEMENTS_STORE)) {
        const movements = database.createObjectStore(MOVEMENTS_STORE, { keyPath: 'id' });
        movements.createIndex(OCCURRED_AT_INDEX, OCCURRED_AT_INDEX);
      }
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = database.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        queue.createIndex(QUEUE_CREATED_AT_INDEX, QUEUE_CREATED_AT_INDEX);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      // Another tab asking for a newer version must never wait for this one to be closed.
      database.onversionchange = () => {
        database.close();
      };
      resolve(database);
    };
    request.onerror = () => {
      reject(new LocalStoreUnavailable(undefined, { cause: request.error }));
    };
    request.onblocked = () => {
      reject(new LocalStoreUnavailable('The local store is blocked by another tab'));
    };
  });
}
