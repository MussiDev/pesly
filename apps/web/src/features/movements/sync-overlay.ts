import type { MovementResponse } from '@pesly/shared';
import {
  changeToMovement,
  type QueuedMovement,
  type QueuedOperation,
} from '@/lib/local-store/queue';

/** Where a movement stands against the server: saved there, waiting on the device, or refused. */
export type SyncState = 'pending' | 'synced' | 'failed';

export interface SyncFailure {
  operation: QueuedOperation;
  /** The error code the server answered; it selects a message and is never shown as text. */
  code: string;
}

export interface OverlaidMovement {
  movement: MovementResponse;
  syncState: SyncState;
  failure?: SyncFailure;
}

export interface OverlayOptions {
  /**
   * Whether queued changes of movements that are not in the loaded rows are added: true when no
   * filter is on, since a queued change was never matched against one.
   */
  includeUnlisted: boolean;
  /** The currency of each account, to read the implied rate of a queued exchange. */
  currencies?: ReadonlyMap<string, string>;
}

function overlaid(
  record: QueuedMovement,
  currencies: OverlayOptions['currencies'],
): OverlaidMovement {
  const movement = changeToMovement(record, currencies);
  return record.rejection === undefined
    ? { movement, syncState: 'pending' }
    : {
        movement,
        syncState: 'failed',
        failure: { operation: record.operation, code: record.rejection.code },
      };
}

/** A pending delete is not shown: the person asked for the movement to be gone. */
function isHidden(record: QueuedMovement): boolean {
  return record.operation === 'delete' && record.rejection === undefined;
}

function newestFirst(a: OverlaidMovement, b: OverlaidMovement): number {
  return new Date(b.movement.occurredAt).getTime() - new Date(a.movement.occurredAt).getTime();
}

/**
 * Merges the loaded rows and the queued changes into the rows the list shows, each with its sync
 * state (D6 and D7 of the spec): a row with no queued change is synced, one with a change shows the
 * change as pending or failed, and a pending delete hides its row. The result is newest first.
 */
export function overlayQueue(
  page: readonly MovementResponse[],
  queue: readonly QueuedMovement[],
  { includeUnlisted, currencies }: OverlayOptions,
): OverlaidMovement[] {
  const byId = new Map(queue.map((record) => [record.id, record]));
  const rows: OverlaidMovement[] = [];
  for (const movement of page) {
    const record = byId.get(movement.id);
    byId.delete(movement.id);
    if (record === undefined) rows.push({ movement, syncState: 'synced' });
    else if (!isHidden(record)) {
      // A create the server already has shows the server's row until the queue settles it.
      const shown = overlaid(record, currencies);
      rows.push(record.operation === 'create' ? { ...shown, movement } : shown);
    }
  }
  if (includeUnlisted) {
    for (const record of byId.values()) {
      if (!isHidden(record)) rows.push(overlaid(record, currencies));
    }
  }
  return rows.sort(newestFirst);
}
