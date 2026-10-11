'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  discardGroupChange,
  loadGroupQueue,
  queueGroupDelete,
  queueGroupUpdate,
  retryGroupChange,
  withGroupQueue,
  type GroupDeleteInput,
  type GroupRecordKind,
  type GroupUpdateInput,
  type QueuedGroupChange,
} from '@/lib/local-store/group-queue';
import { readSessionPointer } from '@/lib/local-store/session-pointer';
import {
  notifyGroupChangeQueued,
  notifyQueueChanged,
  onQueueChanged,
} from '@/lib/sync/sync-events';

interface ChangesState {
  ready: boolean;
  available: boolean;
  changes: QueuedGroupChange[];
}

export interface GroupChanges extends ChangesState {
  /** Stores an edit and asks for a pass; `false` when the queue refused it or cannot be written. */
  queueUpdate: (input: GroupUpdateInput) => Promise<boolean>;
  queueDelete: (input: GroupDeleteInput) => Promise<boolean>;
  retry: (kind: GroupRecordKind, id: string) => Promise<boolean>;
  discard: (kind: GroupRecordKind, id: string) => Promise<boolean>;
}

/**
 * The queued changes of one group and the four things a screen can do with them. Every edit or
 * delete goes to the device queue and the existing sync pass sends it (D2): this hook never calls
 * the API.
 */
export function useGroupChanges(groupId: string): GroupChanges {
  const [state, setState] = useState<ChangesState>({ ready: false, available: false, changes: [] });

  useEffect(() => {
    let current = true;
    const load = (): void => {
      const userId = readSessionPointer()?.userId;
      if (userId === undefined) {
        setState({ ready: true, available: false, changes: [] });
        return;
      }
      withGroupQueue(userId, (database) => loadGroupQueue(database)).then(
        (queue) => {
          if (!current) return;
          setState({
            ready: true,
            available: true,
            changes: queue.filter((change) => change.groupId === groupId),
          });
        },
        () => {
          // An unreadable store: the screens say so instead of showing an empty queue.
          if (current) setState({ ready: true, available: false, changes: [] });
        },
      );
    };
    load();
    const stop = onQueueChanged(load);
    return () => {
      current = false;
      stop();
    };
  }, [groupId]);

  const run = useCallback(
    async (
      work: (database: IDBDatabase) => Promise<boolean>,
      asksForPass: boolean,
    ): Promise<boolean> => {
      const userId = readSessionPointer()?.userId;
      if (userId === undefined) return false;
      let stored: boolean;
      try {
        stored = await withGroupQueue(userId, work);
      } catch {
        // A request the shared contract refuses, or a store that cannot be written: nothing was
        // stored, and the screen shows the unavailable text.
        return false;
      }
      if (stored) {
        notifyQueueChanged();
        if (asksForPass) notifyGroupChangeQueued();
      }
      return stored;
    },
    [],
  );

  const queueUpdate = useCallback(
    (input: GroupUpdateInput) => run((database) => queueGroupUpdate(database, input), true),
    [run],
  );
  const queueDelete = useCallback(
    (input: GroupDeleteInput) => run((database) => queueGroupDelete(database, input), true),
    [run],
  );
  const retry = useCallback(
    (kind: GroupRecordKind, id: string) =>
      run((database) => retryGroupChange(database, kind, id), true),
    [run],
  );
  const discard = useCallback(
    (kind: GroupRecordKind, id: string) =>
      run((database) => discardGroupChange(database, kind, id), false),
    [run],
  );

  return { ...state, queueUpdate, queueDelete, retry, discard };
}
