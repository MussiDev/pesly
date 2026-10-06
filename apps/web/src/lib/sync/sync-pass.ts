import type { ApiResult } from '@/lib/api-client';
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
  const pending = items.filter((item) => item.rejection === undefined);
  const outcome: SyncPassOutcome = { sent: 0, rejected: 0 };
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
          await onSent(item.id, result.data);
        } catch {
          // Left in the queue, the movement is sent again and the server answers it as a repeat.
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

      outcome.rejected += 1;
      try {
        await onRejected(item.id, result.code);
      } catch {
        // Not flagged, the movement is tried again by the next pass and refused again.
      }
    }
  }

  const workers = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: workers }, work));
  return outcome;
}
