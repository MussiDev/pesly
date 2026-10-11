import { isGroupRecordConflict, type ApiGroupConflict, type ApiResult } from '@/lib/api-client';
import type { QueuedGroupChange } from '@/lib/local-store/group-queue';
import type { QueuedMovement } from '@/lib/local-store/queue';

/** How many movements are sent at the same time: enough for a long queue, gentle on the API. */
export const SYNC_CONCURRENCY = 4;

/**
 * Why a pass ended before it went through the whole queue. Every one of them says nothing about a
 * single movement, so every movement stays queued:
 * - `offline`: the request never got an answer;
 * - `unauthenticated` and `not-verified`: the session cannot send anything right now;
 * - `rate-limited`: the limit was reached, `retryAfterSeconds` says when to try again;
 * - `server-error`: the API failed for its own reasons.
 */
export type SyncStopReason =
  'offline' | 'unauthenticated' | 'not-verified' | 'rate-limited' | 'server-error';

export interface SyncPassOutcome {
  sent: number;
  /** Movements the server refused in this pass; they stay in the queue, flagged. */
  rejected: number;
  stopped?: SyncStopReason;
  retryAfterSeconds?: number;
  /** Group records someone else changed first (04e): kept apart from the rejected, never retried. */
  conflicts?: number;
}

export interface SyncPassOptions {
  /** The queue, oldest first; the ones already flagged as rejected are skipped. */
  items: readonly QueuedMovement[];
  /** Sends one queued change (a create, an edit or a delete) to the API. */
  send: (item: QueuedMovement) => Promise<ApiResult<unknown>>;
  /** The server has the change, with its answer, so the queue can settle it. */
  onSent: (id: string, data: unknown) => void | Promise<void>;
  /** The server refused this change: flag it, do not delete it. */
  onRejected: (id: string, code: string) => void | Promise<void>;
  concurrency?: number;
}

const STOP_BY_CODE: Partial<Record<string, SyncStopReason>> = {
  NETWORK: 'offline',
  UNAUTHENTICATED: 'unauthenticated',
  EMAIL_NOT_VERIFIED: 'not-verified',
  RATE_LIMITED: 'rate-limited',
  INTERNAL: 'server-error',
};

interface PassCore<T> {
  items: readonly T[];
  send: (item: T) => Promise<ApiResult<unknown>>;
  onSent: (item: T, data: unknown) => void | Promise<void>;
  onRejected: (item: T, code: string) => void | Promise<void>;
  onConflict?: (item: T, failure: ApiGroupConflict) => void | Promise<void>;
  concurrency: number;
}

/** The loop both passes share: a few requests in flight, one decision per answer. */
async function runPass<T>({
  items: pending,
  send,
  onSent,
  onRejected,
  onConflict,
  concurrency,
}: PassCore<T>): Promise<SyncPassOutcome & { conflicts: number }> {
  const outcome: SyncPassOutcome & { conflicts: number } = { sent: 0, rejected: 0, conflicts: 0 };
  let next = 0;
  // A function, not the property: TypeScript would narrow `stopped` to `undefined` across the awaits.
  const isStopped = () => outcome.stopped !== undefined;

  async function work(): Promise<void> {
    while (!isStopped()) {
      const item = pending[next];
      next += 1;
      if (item === undefined) return;

      let result: Awaited<ReturnType<typeof send>>;
      try {
        result = await send(item);
      } catch {
        // A request that throws never got an answer: the same as no connection.
        result = { ok: false, code: 'NETWORK', messageKey: 'network' };
      }

      if (result.ok) {
        outcome.sent += 1;
        try {
          await onSent(item, result.data);
        } catch {
          // Left in the queue, the change is sent again and the server answers it as a repeat.
        }
        continue;
      }

      const stop = STOP_BY_CODE[result.code];
      if (stop !== undefined) {
        if (!isStopped()) {
          outcome.stopped = stop;
          if (result.retryAfterSeconds !== undefined) {
            outcome.retryAfterSeconds = result.retryAfterSeconds;
          }
        }
        return;
      }

      if (onConflict !== undefined && isGroupRecordConflict(result)) {
        outcome.conflicts += 1;
        try {
          await onConflict(item, result);
        } catch {
          // Not stored, the next pass sends it again and the server answers the conflict again.
        }
        continue;
      }

      outcome.rejected += 1;
      try {
        await onRejected(item, result.code);
      } catch {
        // Not flagged, the change is tried again by the next pass and refused again.
      }
    }
  }

  const workers = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: workers }, work));
  return outcome;
}

/**
 * Sends the queued movements with a few requests in flight and decides per answer: a success
 * removes the movement, a failure that says nothing about it stops the pass, and any other failure
 * is the server refusing that movement, which is flagged and the pass goes on. The same id is sent
 * on every attempt, so a movement the server already stored is answered as a repeat, never created
 * twice; that is what makes stopping, retrying and two passes at once safe.
 */
export async function runSyncPass({
  items,
  send,
  onSent,
  onRejected,
  concurrency = SYNC_CONCURRENCY,
}: SyncPassOptions): Promise<SyncPassOutcome> {
  const outcome: SyncPassOutcome = await runPass<QueuedMovement>({
    items: items.filter((item) => item.rejection === undefined),
    send,
    onSent: (item, data) => onSent(item.id, data),
    onRejected: (item, code) => onRejected(item.id, code),
    concurrency,
  });
  delete outcome.conflicts;
  return outcome;
}

export interface GroupSyncPassOptions {
  /** The queue, oldest first; the ones flagged as rejected or in conflict are skipped. */
  items: readonly QueuedGroupChange[];
  send: (item: QueuedGroupChange) => Promise<ApiResult<unknown>>;
  onSent: (item: QueuedGroupChange, data: unknown) => void | Promise<void>;
  onRejected: (item: QueuedGroupChange, code: string) => void | Promise<void>;
  /** The record changed on the server first: keep its copy next to the local change. */
  onConflict: (item: QueuedGroupChange, failure: ApiGroupConflict) => void | Promise<void>;
  concurrency?: number;
}

/**
 * The same decisions for group record changes, plus one: a conflict answer is stored and the pass
 * goes on, and a record in conflict is skipped by every later pass until the person resolves it
 * (FR-01). Its outcome always carries `conflicts`.
 */
export function runGroupSyncPass({
  items,
  send,
  onSent,
  onRejected,
  onConflict,
  concurrency = SYNC_CONCURRENCY,
}: GroupSyncPassOptions): Promise<SyncPassOutcome & { conflicts: number }> {
  return runPass<QueuedGroupChange>({
    items: items.filter((item) => item.rejection === undefined && item.conflict === undefined),
    send,
    onSent,
    onRejected,
    onConflict,
    concurrency,
  });
}
