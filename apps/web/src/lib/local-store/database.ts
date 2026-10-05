/** Version 1 of every user's database: the two object stores and the index the list needs. */
export const DATABASE_VERSION = 1;

/** Out-of-line keys such as `accounts` or `tags`: one value per kind of reference data. */
export const REFERENCE_STORE = 'reference';
/** The recent movements, keyed by their `id` and indexed by `occurredAt`. */
export const MOVEMENTS_STORE = 'movements';
export const OCCURRED_AT_INDEX = 'occurredAt';

export type StoreName = typeof REFERENCE_STORE | typeof MOVEMENTS_STORE;

/** IndexedDB is missing or refused to open (a private window, an old browser, a blocked upgrade). */
export class LocalStoreUnavailable extends Error {
  constructor(message = 'The local store is not available', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LocalStoreUnavailable';
  }
}

const USER_ID = /^[A-Za-z0-9-]+$/;

/** One database per user: the id is part of the name, so it can only be letters, digits and hyphens. */
export function databaseNameFor(userId: string): string {
  if (!USER_ID.test(userId)) throw new TypeError('The user id is not valid for a database name');
  return `pesly-${userId}`;
}

export async function openLocalDatabase(userId: string): Promise<IDBDatabase> {
  const name = databaseNameFor(userId);
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
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new LocalStoreUnavailable(undefined, { cause: request.error }));
    };
    request.onblocked = () => {
      reject(new LocalStoreUnavailable('The local store is blocked by another tab'));
    };
  });
}
