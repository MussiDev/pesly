import { databaseNameFor } from './database';
import { clearSessionPointer } from './session-pointer';
import { addToWipeMarker, readWipeMarker } from './wipe-marker';

/**
 * `pending`: another tab still holds a connection; it closes on `versionchange`, so the deletion
 * completes on its own. `unavailable`: no IndexedDB, the deletion failed, or the id is invalid.
 */
export type WipeResult = 'deleted' | 'pending' | 'unavailable';

function deleteDatabase(name: string): Promise<WipeResult> {
  const factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB;
  if (factory === undefined) return Promise.resolve('unavailable');

  return new Promise<WipeResult>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(name);
    } catch {
      // The browser refused the request; the marker makes the next start try again.
      resolve('unavailable');
      return;
    }
    request.onsuccess = () => {
      resolve('deleted');
    };
    request.onerror = () => {
      resolve('unavailable');
    };
    // Not a failure: the request keeps going and completes once the other tab closes.
    request.onblocked = () => {
      resolve('pending');
    };
  });
}

/**
 * Deletes the whole database of the user, so every store goes with it. The marker is written
 * first and never removed here: an interrupted wipe leaves nothing the app can reopen.
 */
export async function wipeLocalData(userId: string): Promise<WipeResult> {
  let name: string;
  try {
    name = databaseNameFor(userId);
  } catch {
    // An invalid id names no database: nothing is touched, not even the marker or the pointer.
    return 'unavailable';
  }
  addToWipeMarker(userId);
  clearSessionPointer();
  return deleteDatabase(name);
}

/**
 * Finishes the wipes an earlier visit left half way; the marker stays as it is. `databaseNameFor`
 * cannot throw here: `readWipeMarker` only answers ids that match the same rule.
 */
export async function resumePendingWipes(): Promise<void> {
  await Promise.all(readWipeMarker().map((userId) => deleteDatabase(databaseNameFor(userId))));
}
