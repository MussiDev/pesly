import { movementResponseSchema } from '@pesly/shared';
import type { ApiClient, ApiResult } from '@/lib/api-client';
import { isOffline } from '@/lib/connectivity';
import { loadQueue, markRejected, settleSent, type QueuedMovement } from '@/lib/local-store/queue';
import { putRecentMovement, removeRecentMovement } from '@/lib/local-store/reference-cache';
import { openLocalStore, type LocalStore } from '@/lib/local-store/stores';
import { retryDelaySeconds } from './backoff';
import { notifyQueueChanged, notifySyncFinished } from './sync-events';
import { runSyncPass, type SyncPassOutcome, type SyncStopReason } from './sync-pass';

type SyncApi = Pick<ApiClient, 'createMovement' | 'updateMovement' | 'deleteMovement'>;

/** Users whose pass is running in this tab: the guard for a browser without Web Locks. */
const runningHere = new Set<string>();

/** Stops that a later attempt can get past on its own, retried with backoff (D9 of the spec). */
const RETRIED_WITH_BACKOFF: ReadonlySet<SyncStopReason> = new Set(['offline', 'server-error']);

/** Consecutive passes of each user that stopped on a network or server error. */
const stoppedPasses = new Map<string, number>();

let retryTimer: ReturnType<typeof setTimeout> | undefined;

function clearRetryTimer(): void {
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  retryTimer = undefined;
}

/** Cancels any scheduled retry and forgets the backoff; the shell calls it when it unmounts. */
export function cancelSyncRetry(): void {
  clearRetryTimer();
  stoppedPasses.clear();
}

function scheduleRetry(userId: string, api: SyncApi, seconds: number): void {
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void syncMovementQueue(userId, api);
  }, seconds * 1000);
}

/** What happens after a pass: a retry after `Retry-After`, a retry with backoff, or nothing. */
function planRetry(userId: string, api: SyncApi, outcome: SyncPassOutcome): void {
  const { stopped } = outcome;
  if (stopped === undefined) {
    stoppedPasses.delete(userId);
    clearRetryTimer();
    return;
  }
  if (stopped === 'rate-limited' && outcome.retryAfterSeconds !== undefined) {
    scheduleRetry(userId, api, outcome.retryAfterSeconds);
    return;
  }
  if (!RETRIED_WITH_BACKOFF.has(stopped)) {
    clearRetryTimer();
    return;
  }
  const attempt = (stoppedPasses.get(userId) ?? 0) + 1;
  stoppedPasses.set(userId, attempt);
  // Offline in the browser's own words: the `online` event starts the next pass, not a timer.
  if (isOffline()) clearRetryTimer();
  else scheduleRetry(userId, api, retryDelaySeconds(attempt));
}

/** Sends one queued change with the request its operation needs. */
async function send(api: SyncApi, item: QueuedMovement): Promise<ApiResult<unknown>> {
  if (item.operation === 'create') return api.createMovement(item.request);
  if (item.operation === 'update') return api.updateMovement(item.id, item.request);
  const result = await api.deleteMovement(item.id);
  // Already gone, on another device or by an earlier attempt whose answer was lost: done.
  return !result.ok && result.code === 'NOT_FOUND' ? { ok: true, data: undefined } : result;
}

/** The device copy follows what the server answered, so it shows the version the server kept. */
async function updateCopy(store: LocalStore, item: QueuedMovement, data: unknown): Promise<void> {
  try {
    if (item.operation === 'delete') {
      await removeRecentMovement(store, item.id);
      return;
    }
    const stored = movementResponseSchema.safeParse(data);
    if (stored.success) await putRecentMovement(store, stored.data);
  } catch {
    // The queue is already settled; the next online load replaces the copy anyway.
  }
}

async function runLocked(userId: string, api: SyncApi): Promise<SyncPassOutcome | undefined> {
  let store: LocalStore;
  try {
    store = await openLocalStore(userId);
  } catch {
    // No IndexedDB or a blocked upgrade: there is no queue to send, and nothing to report.
    return undefined;
  }
  try {
    const items = await loadQueue(store);
    const byId = new Map(items.map((item) => [item.id, item]));
    let changed = false;
    // A function, not the variable: TypeScript would narrow `changed` to `false` across the awaits.
    const hasChanged = () => changed;
    const outcome = await runSyncPass({
      items,
      send: (item) => send(api, item),
      onSent: async (id, data) => {
        const item = byId.get(id);
        if (item === undefined) return;
        const stored = movementResponseSchema.safeParse(data);
        await settleSent(store, id, item.revision, stored.success ? stored.data : undefined);
        changed = true;
        await updateCopy(store, item, data);
      },
      onRejected: async (id, code) => {
        await markRejected(store, id, code, byId.get(id)?.revision);
        changed = true;
      },
    });
    if (hasChanged()) notifyQueueChanged();
    if (outcome.sent > 0) notifySyncFinished();
    planRetry(userId, api, outcome);
    return outcome;
  } catch {
    // Whatever went wrong, the queue is left as it was and the next trigger tries again.
    return undefined;
  } finally {
    store.close();
  }
}

/**
 * Sends the queued changes of one user, once at a time: across tabs through a Web Lock named for
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
