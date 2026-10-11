import {
  groupExpenseResponseSchema,
  settlementResponseSchema,
  type GroupExpenseResponse,
  type SettlementResponse,
} from '@pesly/shared';
import type { ApiClient, ApiResult } from '@/lib/api-client';
import {
  cacheGroupRecord,
  groupChangeBody,
  loadGroupQueue,
  markGroupConflict,
  markGroupRejected,
  settleGroupSent,
  withGroupQueue,
  type QueuedGroupChange,
} from '@/lib/local-store/group-queue';
import { runGroupSyncPass, type SyncPassOutcome } from './sync-pass';

/** The group endpoints a pass needs; an api without them leaves the group queue alone. */
export type GroupSyncApi = Pick<
  ApiClient,
  'updateGroupExpense' | 'deleteGroupExpense' | 'updateSettlement' | 'deleteSettlement'
>;

export function hasGroupApi(api: Partial<GroupSyncApi>): api is GroupSyncApi {
  return (
    api.updateGroupExpense !== undefined &&
    api.deleteGroupExpense !== undefined &&
    api.updateSettlement !== undefined &&
    api.deleteSettlement !== undefined
  );
}

/** Sends one queued change with the base version of its record (`baseVersion`). */
async function send(api: GroupSyncApi, item: QueuedGroupChange): Promise<ApiResult<unknown>> {
  if (item.operation === 'delete') {
    const result =
      item.kind === 'expense'
        ? await api.deleteGroupExpense(item.groupId, item.id, item.base.version)
        : await api.deleteSettlement(item.groupId, item.id, item.base.version);
    // Already gone, on another device or by an earlier attempt whose answer was lost: done.
    return !result.ok && result.code === 'NOT_FOUND' ? { ok: true, data: undefined } : result;
  }
  const body = groupChangeBody(item);
  if (body === undefined) return { ok: false, code: 'VALIDATION_FAILED', messageKey: 'unexpected' };
  // The record validated the request when it was queued, so the body matches its kind.
  return item.kind === 'expense'
    ? api.updateGroupExpense(
        item.groupId,
        item.id,
        body as Parameters<GroupSyncApi['updateGroupExpense']>[2],
      )
    : api.updateSettlement(item.groupId, item.id, body);
}

/** The reply of an accepted edit, read with the schema of its kind; anything else is not cached. */
function parseReply(
  item: QueuedGroupChange,
  data: unknown,
): GroupExpenseResponse | SettlementResponse | undefined {
  const schema = item.kind === 'expense' ? groupExpenseResponseSchema : settlementResponseSchema;
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/**
 * One pass over the group queue, under the lock the caller already holds. A conflict answer is
 * stored next to the untouched request and the record is skipped until the person resolves it; the
 * server's reply of an accepted edit goes to the device copy, and a deletion removes it.
 */
export async function runGroupLocked(
  userId: string,
  api: GroupSyncApi,
): Promise<{ outcome: SyncPassOutcome & { conflicts: number }; changed: boolean } | undefined> {
  try {
    return await withGroupQueue(userId, async (database) => {
      const items = await loadGroupQueue(database);
      let changed = false;
      // A function, not the variable: TypeScript would narrow `changed` to `false` across the awaits.
      const hasChanged = () => changed;
      const outcome = await runGroupSyncPass({
        items,
        send: (item) => send(api, item),
        onSent: async (item, data) => {
          await settleGroupSent(database, item.kind, item.id, item.revision);
          changed = true;
          try {
            const reply = item.operation === 'delete' ? null : (parseReply(item, data) ?? null);
            await cacheGroupRecord(database, item.kind, item.id, reply);
          } catch {
            // The queue is already settled; the next online load replaces the copy anyway.
          }
        },
        onRejected: async (item, code) => {
          await markGroupRejected(database, item.kind, item.id, code, item.revision);
          changed = true;
        },
        onConflict: async (item, failure) => {
          const stored = await markGroupConflict(
            database,
            item.kind,
            item.id,
            item.revision,
            failure.current,
          );
          if (stored) changed = true;
        },
      });
      return { outcome, changed: hasChanged() };
    });
  } catch {
    // No IndexedDB or a failed read: the queue is left as it was and the next trigger tries again.
    return undefined;
  }
}
