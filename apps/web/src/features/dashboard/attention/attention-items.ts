import type { ActionView } from '../dashboard-view';

/** What waits on this device and needs the user, read from the local queues. */
export interface QueueAttention {
  failedMovements: number;
  failedGroupChanges: number;
  groupConflicts: number;
}

export type QueueItemKind = 'failedMovements' | 'failedGroupChanges' | 'groupConflicts';

export type AttentionItem =
  | { source: 'server'; key: string; href: string; action: ActionView }
  | { source: 'queue'; key: string; href: string; kind: QueueItemKind; count: number };

const QUEUE_LINKS: ReadonlyArray<{ kind: QueueItemKind; href: string }> = [
  { kind: 'failedMovements', href: '/movements' },
  { kind: 'failedGroupChanges', href: '/groups' },
  { kind: 'groupConflicts', href: '/groups' },
];

/**
 * The server actions in the order received (overdue first, as the API orders them) followed by one
 * item per non-zero device-queue count (FR-11, FR-12).
 */
export function buildAttentionItems(
  actions: readonly ActionView[],
  queue: QueueAttention,
): AttentionItem[] {
  const server = actions.map((action, index): AttentionItem => ({
    source: 'server',
    key: `server:${index}:${action.href}`,
    href: action.href,
    action,
  }));
  const device = QUEUE_LINKS.flatMap(({ kind, href }): AttentionItem[] =>
    queue[kind] > 0
      ? [{ source: 'queue', key: `queue:${kind}`, href, kind, count: queue[kind] }]
      : [],
  );
  return [...server, ...device];
}
