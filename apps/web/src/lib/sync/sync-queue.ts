import type { ApiClient } from '@/lib/api-client';
import { isOffline } from '@/lib/connectivity';
import { loadQueue, markRejected, removeQueued } from '@/lib/local-store/queue';
import { openLocalStore } from '@/lib/local-store/stores';
import { notifySyncFinished } from './sync-events';
import { runSyncPass, type SyncPassOutcome } from './sync-pass';

type SyncApi = Pick<ApiClient, 'createMovement'>;

/** Users whose pass is running in this tab: the guard for a browser without Web Locks. */
const runningHere = new Set<string>();

let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Cancels the retry a rate-limited pass scheduled; the shell calls it when it unmounts. */
export function cancelSyncRetry(): void {
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  retryTimer = undefined;
}

function scheduleRetry(userId: string, api: SyncApi, seconds: number): void {
  cancelSyncRetry();
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void syncMovementQueue(userId, api);
  }, seconds * 1000);
}

async function runLocked(userId: string, api: SyncApi): Promise<SyncPassOutcome | undefined> {
  let store: Awaited<ReturnType<typeof openLocalStore>>;
  try {
    store = await openLocalStore(userId);
  } catch {
    // No IndexedDB or a blocked upgrade: there is no queue to send, and nothing to report.
    return undefined;
  }
  try {
    const items = await loadQueue(store);
    const outcome = await runSyncPass({
      items,
      send: (request) => api.createMovement(request),
      onSent: (id) => removeQueued(store, id),
      onRejected: (id, code) => markRejected(store, id, code),
    });
    if (outcome.sent > 0) notifySyncFinished();
    if (outcome.stopped === 'rate-limited' && outcome.retryAfterSeconds !== undefined) {
      scheduleRetry(userId, api, outcome.retryAfterSeconds);
    }
    return outcome;
  } catch {
    // Whatever went wrong, the queue is left as it was and the next trigger tries again.
    return undefined;
  } finally {
    store.close();
  }
}

/**
 * Sends the queued movements of one user, once at a time: across tabs through a Web Lock named for
 * the user, and inside a tab through a guard when the browser has no Web Locks. A second call while
 * one runs does nothing and answers `undefined`, as it does while offline. If two passes ever ran
 * together the server would answer the second one's repeats as repeats, so nothing is duplicated.
 */
export async function syncMovementQueue(
  userId: string,
  api: SyncApi,
): Promise<SyncPassOutcome | undefined> {
  if (isOffline()) return undefined;

  // Missing in older browsers, and `null` in some test environments: both mean "no Web Locks".
  const locks =
    typeof navigator === 'undefined' ? undefined : (navigator.locks as LockManager | undefined);
  if (locks) {
    return locks.request(`pesly-sync-${userId}`, { ifAvailable: true }, (lock) =>
      lock === null ? Promise.resolve(undefined) : runLocked(userId, api),
    );
  }

  if (runningHere.has(userId)) return undefined;
  runningHere.add(userId);
  try {
    return await runLocked(userId, api);
  } finally {
    runningHere.delete(userId);
  }
}
