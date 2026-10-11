import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import {
  groupChangeKey,
  type GroupRecordKind,
  type QueuedGroupChange,
} from '@/lib/local-store/group-queue';

/**
 * Where a group record stands against the server: saved there, waiting on the device, refused, or
 * changed by someone else first and waiting for the person to choose (FR-04).
 */
export type SyncState = 'pending' | 'synced' | 'failed' | 'conflict';

export interface GroupSyncFailure {
  operation: 'update' | 'delete';
  /** The error code the server answered; it selects a message and is never shown as text. */
  code: string;
}

export interface OverlaidGroupRecord<T extends GroupExpenseResponse | SettlementResponse> {
  /** The record as loaded; the container reads what the person changed from `change`. */
  record: T;
  syncState: SyncState;
  /** Only when failed. */
  failure?: GroupSyncFailure;
  /** The server's copy, only when in conflict. */
  server?: GroupExpenseResponse | SettlementResponse;
  /** The queued change, whenever there is one. */
  change?: QueuedGroupChange;
}

function stateOf(change: QueuedGroupChange | undefined): SyncState {
  if (change === undefined) return 'synced';
  if (change.conflict !== undefined) return 'conflict';
  return change.rejection === undefined ? 'pending' : 'failed';
}

/** The state of one record, read from the queue records of every kind. */
export function groupSyncState(
  kind: GroupRecordKind,
  id: string,
  queue: readonly QueuedGroupChange[],
): SyncState {
  const key = groupChangeKey(kind, id);
  return stateOf(queue.find((change) => change.key === key));
}

/**
 * Pairs the loaded rows with their queued change, in the order they came: a row with no change is
 * synced, a conflict wins over a rejection, a rejection over a pending change, and a pending delete
 * hides its row because the person asked for it to be gone.
 */
export function overlayGroupRecords<T extends GroupExpenseResponse | SettlementResponse>(
  kind: GroupRecordKind,
  rows: readonly T[],
  queue: readonly QueuedGroupChange[],
): OverlaidGroupRecord<T>[] {
  const byKey = new Map(queue.map((change) => [change.key, change]));
  const result: OverlaidGroupRecord<T>[] = [];
  for (const record of rows) {
    const change = byKey.get(groupChangeKey(kind, record.id));
    const syncState = stateOf(change);
    if (change === undefined) {
      result.push({ record, syncState });
    } else if (syncState === 'pending' && change.operation === 'delete') {
      continue;
    } else {
      result.push({
        record,
        syncState,
        change,
        ...(syncState === 'failed' && change.rejection !== undefined
          ? { failure: { operation: change.operation, code: change.rejection.code } }
          : {}),
        ...(change.conflict === undefined ? {} : { server: change.conflict.server }),
      });
    }
  }
  return result;
}
