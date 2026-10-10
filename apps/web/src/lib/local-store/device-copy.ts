import type { MovementResponse } from '@pesly/shared';
import {
  loadRecentMovements,
  loadReferenceData,
  saveRecentMovements,
  saveReferenceData,
  type ReferenceData,
} from './reference-cache';
import { notifyQueueChanged } from '@/lib/sync/sync-events';
import {
  countQueue,
  discardQueued,
  enqueueMovement,
  loadQueue,
  markRejected,
  queueDelete,
  queueEdit,
  removeQueued,
  retryQueued,
  type QueueCounts,
  type QueuedEditRequest,
  type QueuedMovement,
  type QueuedRequest,
} from './queue';
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

/** A queue write through `withStore`; when it changed the queue, everyone listening hears it. */
async function writeQueue(
  userId: string | undefined,
  work: (store: LocalStore) => Promise<boolean>,
): Promise<boolean> {
  const written = await withStore<boolean>(userId, false, work);
  if (written) notifyQueueChanged();
  return written;
}

/**
 * Saves a movement in the queue of this user. `true` only when it is stored: no user known, no
 * IndexedDB, a blocked upgrade or a request the contract refuses all answer `false`, and nothing is
 * thrown, so the screen can tell the person that the save did not happen.
 */
export function writeQueuedMovement(
  userId: string | undefined,
  request: QueuedRequest,
): Promise<boolean> {
  return writeQueue(userId, async (store) => {
    await enqueueMovement(store, request);
    return true;
  });
}

/** The queued movements of this user, oldest first; empty when none, or when the device cannot say. */
export function readQueuedMovements(userId: string | undefined): Promise<QueuedMovement[]> {
  return withStore<QueuedMovement[]>(userId, [], (store) => loadQueue(store));
}

export async function removeQueuedMovement(userId: string | undefined, id: string): Promise<void> {
  await writeQueue(userId, async (store) => {
    await removeQueued(store, id);
    return true;
  });
}

export async function rejectQueuedMovement(
  userId: string | undefined,
  id: string,
  code: string,
): Promise<void> {
  await writeQueue(userId, async (store) => {
    await markRejected(store, id, code);
    return true;
  });
}

/** Queues an edit of `base`; `false` when it was not stored (see `queueEdit`). */
export function writeQueuedEdit(
  userId: string | undefined,
  base: MovementResponse,
  request: QueuedEditRequest,
): Promise<boolean> {
  return writeQueue(userId, (store) => queueEdit(store, base, request));
}

/** Queues the deletion of `base`; `false` when it was not stored. */
export function writeQueuedDelete(
  userId: string | undefined,
  base: MovementResponse,
): Promise<boolean> {
  return writeQueue(userId, (store) => queueDelete(store, base));
}

export function retryQueuedChange(userId: string | undefined, id: string): Promise<boolean> {
  return writeQueue(userId, (store) => retryQueued(store, id));
}

export function discardQueuedChange(userId: string | undefined, id: string): Promise<boolean> {
  return writeQueue(userId, (store) => discardQueued(store, id));
}

/** The queued change of one movement, or `undefined` when there is none or the device cannot say. */
export function readQueuedChange(
  userId: string | undefined,
  id: string,
): Promise<QueuedMovement | undefined> {
  return withStore<QueuedMovement | undefined>(userId, undefined, async (store) =>
    (await loadQueue(store)).find((item) => item.id === id),
  );
}

/** How many changes wait and how many failed; zero for both when the device cannot say. */
export function readQueueCounts(userId: string | undefined): Promise<QueueCounts> {
  return withStore<QueueCounts>(userId, { pending: 0, failed: 0 }, (store) => countQueue(store));
}
