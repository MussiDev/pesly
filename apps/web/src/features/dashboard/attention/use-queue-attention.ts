'use client';

import { useEffect, useState } from 'react';
import { readQueueCounts } from '@/lib/local-store/device-copy';
import { readSessionPointer } from '@/lib/local-store/session-pointer';
import { readGroupQueueCounts } from '@/lib/sync/group-queue-counts';
import { onQueueChanged, onSyncFinished } from '@/lib/sync/sync-events';
import type { QueueAttention } from './attention-items';

/** How long the skeleton may wait for the local read before the screen shows without the queue. */
const READ_TIMEOUT_MS = 2000;

const EMPTY: QueueAttention = { failedMovements: 0, failedGroupChanges: 0, groupConflicts: 0 };

/**
 * The failed and conflicting changes waiting on this device. It reads the same two local counters
 * as the shell, re-reads on the same events and sends no request, so it works offline (D5). A queue
 * that cannot be read counts as empty and the hook still becomes ready.
 */
export function useQueueAttention(): { ready: boolean; queue: QueueAttention } {
  const [state, setState] = useState<{ ready: boolean; queue: QueueAttention }>({
    ready: false,
    queue: EMPTY,
  });

  useEffect(() => {
    let live = true;
    const read = () => {
      const userId = readSessionPointer()?.userId;
      void Promise.all([
        Promise.resolve(readQueueCounts(userId)).then(
          (counts) => counts.failed,
          () => 0,
        ),
        Promise.resolve(readGroupQueueCounts(userId)).then(
          (counts) => ({ failed: counts.failed, conflict: counts.conflict }),
          () => ({ failed: 0, conflict: 0 }),
        ),
      ]).then(([failedMovements, group]) => {
        if (!live) return;
        setState({
          ready: true,
          queue: {
            failedMovements,
            failedGroupChanges: group.failed,
            groupConflicts: group.conflict,
          },
        });
      });
    };
    // An IndexedDB read that never settles must not keep the skeleton up forever.
    const timer = setTimeout(() => {
      if (live) setState((current) => (current.ready ? current : { ready: true, queue: EMPTY }));
    }, READ_TIMEOUT_MS);
    read();
    const stopQueue = onQueueChanged(read);
    const stopSync = onSyncFinished(read);
    return () => {
      live = false;
      clearTimeout(timer);
      stopQueue();
      stopSync();
    };
  }, []);

  return state;
}
