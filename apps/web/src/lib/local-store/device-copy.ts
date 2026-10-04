import type { MovementResponse } from '@pesly/shared';
import {
  loadRecentMovements,
  loadReferenceData,
  saveRecentMovements,
  saveReferenceData,
  type ReferenceData,
} from './reference-cache';
import { openLocalStore, type LocalStore } from './stores';

/**
 * Opens the store of one user for one operation and always closes it. Any failure (no user known,
 * no IndexedDB, a broken store) becomes `fallback`: the copy is a convenience, so it never throws
 * into a screen that is working.
 */
async function withStore<T>(
  userId: string | undefined,
  fallback: T,
  work: (store: LocalStore) => Promise<T>,
): Promise<T> {
  if (userId === undefined) return fallback;
  try {
    const store = await openLocalStore(userId);
    try {
      return await work(store);
    } finally {
      store.close();
    }
  } catch {
    return fallback;
  }
}

/** The reference data saved for this user, or `null`: no user, nothing saved, or no store. */
export function readReferenceCopy(userId: string | undefined): Promise<ReferenceData | null> {
  return withStore<ReferenceData | null>(userId, null, (store) => loadReferenceData(store));
}

export async function writeReferenceCopy(userId: string, data: ReferenceData): Promise<void> {
  await withStore<true>(userId, true, async (store) => {
    await saveReferenceData(store, data);
    return true;
  });
}

/**
 * The saved movements of this user, newest first: an empty list when none were saved, and `null`
 * only when the device cannot say (no user, or no store), which a screen reads as "no copy".
 */
export function readRecentMovementsCopy(
  userId: string | undefined,
): Promise<MovementResponse[] | null> {
  return withStore<MovementResponse[] | null>(userId, null, (store) => loadRecentMovements(store));
}

export async function writeRecentMovementsCopy(
  userId: string,
  movements: readonly MovementResponse[],
): Promise<void> {
  await withStore<true>(userId, true, async (store) => {
    await saveRecentMovements(store, movements);
    return true;
  });
}
