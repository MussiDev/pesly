import {
  groupExpenseResponseSchema,
  movementAmountSchema,
  occurredAtSchema,
  settlementResponseSchema,
  updateGroupExpenseRequestSchema,
  type GroupExpenseResponse,
  type SettlementResponse,
  type UpdateGroupExpenseRequest,
  type UpdateSettlementRequest,
} from '@pesly/shared';
import { z } from 'zod';
import {
  GROUP_QUEUE_CREATED_AT_INDEX,
  GROUP_QUEUE_STORE,
  REFERENCE_STORE,
  openLocalDatabase,
} from './database';

/** The two kinds of group record a change can target (spec D5). */
export type GroupRecordKind = 'expense' | 'settlement';

/** The longest error code kept on a rejected change: a short code, never a message. */
const REJECTION_CODE_MAX_LENGTH = 64;

const expenseRequestSchema = updateGroupExpenseRequestSchema.omit({ baseVersion: true });

const settlementRequestSchema = z
  .strictObject({
    amount: movementAmountSchema.optional(),
    occurredAt: occurredAtSchema.optional(),
  })
  .refine((request) => request.amount !== undefined || request.occurredAt !== undefined, {
    message: 'Send at least one of amount or occurredAt',
  });

/** What an edit carries: the body of the update call without `baseVersion`, which the record owns. */
export type ExpenseEditRequest = z.input<typeof expenseRequestSchema>;
export type SettlementEditRequest = z.input<typeof settlementRequestSchema>;

const commonFields = {
  key: z.string().min(1),
  id: z.string().min(1),
  groupId: z.string().min(1),
  operation: z.enum(['update', 'delete']),
  createdAt: z.iso.datetime(),
  revision: z.number().int().min(0),
  rejection: z.object({ code: z.string().min(1).max(REJECTION_CODE_MAX_LENGTH) }).optional(),
};

const expenseChangeShape = z.object({
  kind: z.literal('expense'),
  ...commonFields,
  request: expenseRequestSchema.optional(),
  base: groupExpenseResponseSchema,
  conflict: z.object({ server: groupExpenseResponseSchema }).optional(),
});

const settlementChangeShape = z.object({
  kind: z.literal('settlement'),
  ...commonFields,
  request: settlementRequestSchema.optional(),
  base: settlementResponseSchema,
  conflict: z.object({ server: settlementResponseSchema }).optional(),
});

/**
 * What the queue stores for one group record that has a change the server does not have yet: one
 * record per kind and id. `base` is the server record the change was made on (the oldest one, kept
 * through folds), `revision` grows with every local change, `rejection` is set when the server
 * refused the change, and `conflict` holds the server's copy when someone else changed the record
 * first, next to the untouched local request (FR-01, FR-03).
 */
export const queuedGroupChangeSchema = z
  .discriminatedUnion('kind', [expenseChangeShape, settlementChangeShape])
  .refine(
    (item) =>
      item.key === groupChangeKey(item.kind, item.id) &&
      item.base.id === item.id &&
      item.base.groupId === item.groupId &&
      (item.conflict === undefined ||
        (item.conflict.server.id === item.id && item.conflict.server.groupId === item.groupId)) &&
      (item.operation === 'update') === (item.request !== undefined),
    { message: 'The record must carry the key, ids and request of its operation' },
  );

export type QueuedGroupChange = z.infer<typeof queuedGroupChangeSchema>;

export function groupChangeKey(kind: GroupRecordKind, id: string): string {
  return `${kind}:${id}`;
}

/** Where the device keeps the copy of a group record the person chose (`keepServer`). */
function cacheKey(kind: GroupRecordKind, id: string): string {
  return `groupRecord:${kind}:${id}`;
}

/** A resolution that cannot be applied: the record is gone, or it is not in conflict. */
export class GroupResolutionRefused extends Error {
  readonly reason: 'not-queued' | 'no-conflict';

  constructor(reason: 'not-queued' | 'no-conflict') {
    super(
      reason === 'not-queued'
        ? 'There is no queued group change to resolve'
        : 'The queued group change has no conflict to resolve',
    );
    this.name = 'GroupResolutionRefused';
    this.reason = reason;
  }
}

/**
 * Test seam for NFR-01: called after each step of a resolution, inside its transaction. Throwing, or
 * calling `abort`, interrupts it, and the transaction must leave the state as it was.
 */
export interface ResolutionHooks {
  onStep?: (step: number, abort: () => void) => void;
}

function parseChange(raw: unknown): QueuedGroupChange | undefined {
  const parsed = queuedGroupChangeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** A record validated before it is written: one that does not fit throws, and nothing is stored. */
function checked(record: unknown): QueuedGroupChange {
  return queuedGroupChangeSchema.parse(record);
}

function withoutRejection(record: QueuedGroupChange): QueuedGroupChange {
  const copy = { ...record };
  delete copy.rejection;
  return copy;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('IndexedDB transaction aborted');
}

/**
 * Runs `work` in one transaction over `stores` and settles when it commits or aborts. A throw inside
 * `work` or inside a request callback aborts the whole transaction, so nothing it wrote survives.
 */
function transact<T>(
  database: IDBDatabase,
  stores: string[],
  work: (
    transaction: IDBTransaction,
    fail: (error: unknown) => void,
    done: (value: T) => void,
  ) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(stores, 'readwrite');
    let failure: unknown;
    let result: T | undefined;
    const fail = (error: unknown): void => {
      failure ??= error;
      try {
        transaction.abort();
      } catch {
        // Already finished: the abort handler below settles the promise.
      }
    };
    transaction.oncomplete = () => {
      resolve(result as T);
    };
    transaction.onerror = () => {
      reject(toError(failure ?? transaction.error));
    };
    transaction.onabort = () => {
      reject(toError(failure ?? transaction.error));
    };
    try {
      work(transaction, fail, (value) => {
        result = value;
      });
    } catch (error) {
      fail(error);
    }
  });
}

/** Reads one queued record and writes what `change` answers: `undefined` leaves it, `null` deletes it. */
function updateChange<T>(
  database: IDBDatabase,
  key: string,
  change: (current: unknown) => { next: unknown; value: T },
): Promise<T> {
  return transact<T>(database, [GROUP_QUEUE_STORE], (transaction, fail, done) => {
    const store = transaction.objectStore(GROUP_QUEUE_STORE);
    const read = store.get(key);
    read.onsuccess = () => {
      try {
        const { next, value } = change(read.result);
        if (next === null) store.delete(key);
        else if (next !== undefined) store.put(next);
        done(value);
      } catch (error) {
        fail(error);
      }
    };
  });
}

export type GroupUpdateInput =
  | { kind: 'expense'; base: GroupExpenseResponse; request: ExpenseEditRequest }
  | { kind: 'settlement'; base: SettlementResponse; request: SettlementEditRequest };

export type GroupDeleteInput =
  | { kind: 'expense'; base: GroupExpenseResponse }
  | { kind: 'settlement'; base: SettlementResponse };

/**
 * Queues an edit of a group record, in one transaction, folding it into whatever is queued for the
 * same record (D5): the request is replaced and the oldest base is kept. A queued delete or an
 * unreadable record answers `false` and changes nothing. A request that does not pass the shared
 * contract throws and nothing is stored. Any edit clears a rejection; an open conflict stays open.
 */
export function queueGroupUpdate(
  database: IDBDatabase,
  input: GroupUpdateInput,
  now: Date = new Date(),
): Promise<boolean> {
  const key = groupChangeKey(input.kind, input.base.id);
  return updateChange(database, key, (raw) => {
    if (raw === undefined) {
      return {
        value: true,
        next: checked({
          key,
          kind: input.kind,
          id: input.base.id,
          groupId: input.base.groupId,
          operation: 'update',
          request: input.request,
          base: input.base,
          createdAt: now.toISOString(),
          revision: 1,
        }),
      };
    }
    const current = parseChange(raw);
    if (current === undefined || current.operation === 'delete') {
      return { value: false, next: undefined };
    }
    return {
      value: true,
      next: checked({
        ...withoutRejection(current),
        request: input.request,
        revision: current.revision + 1,
      }),
    };
  });
}

/**
 * Queues the deletion of a group record, in one transaction. A queued edit becomes the delete and
 * keeps its oldest base; an already queued delete is left as it is. An unreadable record answers
 * `false` and is left alone.
 */
export function queueGroupDelete(
  database: IDBDatabase,
  input: GroupDeleteInput,
  now: Date = new Date(),
): Promise<boolean> {
  const key = groupChangeKey(input.kind, input.base.id);
  return updateChange(database, key, (raw) => {
    if (raw === undefined) {
      return {
        value: true,
        next: checked({
          key,
          kind: input.kind,
          id: input.base.id,
          groupId: input.base.groupId,
          operation: 'delete',
          base: input.base,
          createdAt: now.toISOString(),
          revision: 1,
        }),
      };
    }
    const current = parseChange(raw);
    if (current === undefined) return { value: false, next: undefined };
    if (current.operation === 'delete') return { value: true, next: undefined };
    const replaced: Record<string, unknown> = { ...withoutRejection(current) };
    delete replaced.request;
    return {
      value: true,
      next: checked({ ...replaced, operation: 'delete', revision: current.revision + 1 }),
    };
  });
}

/**
 * The queued changes, oldest first. A stored record that does not parse is left out but never
 * deleted: a later version of the app may still understand it.
 */
export function loadGroupQueue(database: IDBDatabase): Promise<QueuedGroupChange[]> {
  return new Promise((resolve, reject) => {
    const items: QueuedGroupChange[] = [];
    const cursor = database
      .transaction(GROUP_QUEUE_STORE, 'readonly')
      .objectStore(GROUP_QUEUE_STORE)
      .index(GROUP_QUEUE_CREATED_AT_INDEX)
      .openCursor();
    cursor.onsuccess = () => {
      const position = cursor.result;
      if (position === null) {
        resolve(items);
        return;
      }
      const parsed = parseChange(position.value);
      if (parsed !== undefined) items.push(parsed);
      position.continue();
    };
    cursor.onerror = () => {
      reject(toError(cursor.error));
    };
  });
}

/** The queued change of one record, or `undefined` when there is none or it does not parse. */
export function readGroupChange(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
): Promise<QueuedGroupChange | undefined> {
  return new Promise((resolve, reject) => {
    const read = database
      .transaction(GROUP_QUEUE_STORE, 'readonly')
      .objectStore(GROUP_QUEUE_STORE)
      .get(groupChangeKey(kind, id));
    read.onsuccess = () => {
      resolve(read.result === undefined ? undefined : parseChange(read.result));
    };
    read.onerror = () => {
      reject(toError(read.error));
    };
  });
}

/** The server copy the person chose with `keepServer`, or `undefined` when there is none. */
export function readCachedGroupRecord(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
): Promise<GroupExpenseResponse | SettlementResponse | undefined> {
  return new Promise((resolve, reject) => {
    const read = database
      .transaction(REFERENCE_STORE, 'readonly')
      .objectStore(REFERENCE_STORE)
      .get(cacheKey(kind, id));
    read.onsuccess = () => {
      const schema = kind === 'expense' ? groupExpenseResponseSchema : settlementResponseSchema;
      const parsed = schema.safeParse(read.result);
      resolve(parsed.success ? parsed.data : undefined);
    };
    read.onerror = () => {
      reject(toError(read.error));
    };
  });
}

/**
 * The body to send for a queued edit: the request with the base version of the record as
 * `baseVersion`. A deletion has no body (its `baseVersion` goes in the query), so it answers
 * `undefined`.
 */
export function groupChangeBody(
  record: QueuedGroupChange,
): (UpdateGroupExpenseRequest | UpdateSettlementRequest) | undefined {
  if (record.operation === 'delete' || record.request === undefined) return undefined;
  return { ...record.request, baseVersion: record.base.version };
}

/**
 * Stores the server's copy next to the untouched local request, in one transaction, when the server
 * answered that the record changed meanwhile. A record that changed since it was sent (`revision`
 * differs), or is not queued, answers `false` and is left alone: the next pass sends it again. A
 * conflict with a record of another kind throws and stores nothing.
 */
export function markGroupConflict(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
  revision: number,
  server: GroupExpenseResponse | SettlementResponse,
): Promise<boolean> {
  return updateChange(database, groupChangeKey(kind, id), (raw) => {
    const current = parseChange(raw);
    if (current === undefined || current.revision !== revision) {
      return { value: false, next: undefined };
    }
    return {
      value: true,
      next: checked({ ...withoutRejection(current), conflict: { server } }),
    };
  });
}

/**
 * Resolution in one IndexedDB transaction over the queue and the cache (NFR-01): `apply` runs once
 * the record is read, issues every write, and reports each step to the hooks. Any throw or abort
 * rolls everything back, so there is never a state with neither version.
 */
function resolveConflict(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
  hooks: ResolutionHooks,
  apply: (
    record: QueuedGroupChange,
    server: GroupExpenseResponse | SettlementResponse,
    queue: IDBObjectStore,
    cache: IDBObjectStore,
    step: () => void,
  ) => void,
): Promise<void> {
  return transact<undefined>(
    database,
    [GROUP_QUEUE_STORE, REFERENCE_STORE],
    (transaction, fail, done) => {
      const queue = transaction.objectStore(GROUP_QUEUE_STORE);
      const cache = transaction.objectStore(REFERENCE_STORE);
      const read = queue.get(groupChangeKey(kind, id));
      read.onsuccess = () => {
        try {
          const current = read.result === undefined ? undefined : parseChange(read.result);
          if (current === undefined) throw new GroupResolutionRefused('not-queued');
          if (current.conflict === undefined) throw new GroupResolutionRefused('no-conflict');
          let aborted = false;
          let index = 0;
          const step = (): void => {
            const position = index;
            index += 1;
            hooks.onStep?.(position, () => {
              aborted = true;
              transaction.abort();
            });
            if (aborted) throw new Error('The resolution was aborted');
          };
          step();
          apply(current, current.conflict.server, queue, cache, step);
          done(undefined);
        } catch (error) {
          fail(error);
        }
      };
    },
  );
}

/**
 * "Keep mine" (D4): the local change stays queued, now based on the server record that was received
 * and with the conflict cleared, so the next pass resends it with that version. Refused when the
 * record is not queued or has no conflict.
 */
export function keepMine(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
  hooks: ResolutionHooks = {},
): Promise<void> {
  return resolveConflict(database, kind, id, hooks, (record, server, queue, _cache, step) => {
    const rebased: Record<string, unknown> = { ...withoutRejection(record) };
    delete rebased.conflict;
    queue.put(checked({ ...rebased, base: server, revision: record.revision + 1 }));
    step();
  });
}

/**
 * "Keep server's" (D4): the local change is dropped and the server copy is stored in the local
 * cache, both in the same transaction. Refused when the record is not queued or has no conflict.
 */
export function keepServer(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
  hooks: ResolutionHooks = {},
): Promise<void> {
  return resolveConflict(database, kind, id, hooks, (record, server, queue, cache, step) => {
    queue.delete(groupChangeKey(kind, id));
    step();
    cache.put(server, cacheKey(kind, id));
    step();
  });
}

/**
 * Settles a change the server accepted, in one transaction: the record goes only if it is still the
 * revision that was sent; a changed record waits for the next pass with its new values.
 */
export async function settleGroupSent(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
  revision: number,
): Promise<void> {
  await updateChange(database, groupChangeKey(kind, id), (raw) => {
    const current = parseChange(raw);
    if (current === undefined || current.revision !== revision) {
      return { value: undefined, next: undefined };
    }
    return { value: undefined, next: null };
  });
}

/**
 * Flags a change the server refused; it is never deleted here. With a `revision`, a record that
 * changed since it was sent is left unflagged. An id that is not queued is ignored.
 */
export async function markGroupRejected(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
  code: string,
  revision?: number,
): Promise<void> {
  await updateChange(database, groupChangeKey(kind, id), (raw) => {
    const current = parseChange(raw);
    if (current === undefined || (revision !== undefined && current.revision !== revision)) {
      return { value: undefined, next: undefined };
    }
    return {
      value: undefined,
      next: { ...current, rejection: { code: code.slice(0, REJECTION_CODE_MAX_LENGTH) } },
    };
  });
}

/** Clears the rejection of a failed change so the next pass sends it again. */
export function retryGroupChange(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
): Promise<boolean> {
  return updateChange(database, groupChangeKey(kind, id), (raw) => {
    const current = parseChange(raw);
    if (current?.rejection === undefined) return { value: false, next: undefined };
    return {
      value: true,
      next: checked({ ...withoutRejection(current), revision: current.revision + 1 }),
    };
  });
}

/** Drops a queued change: the server never got it, so its version stays the one shown. */
export function discardGroupChange(
  database: IDBDatabase,
  kind: GroupRecordKind,
  id: string,
): Promise<boolean> {
  return updateChange(database, groupChangeKey(kind, id), (raw) =>
    raw === undefined ? { value: false, next: undefined } : { value: true, next: null },
  );
}

export interface GroupQueueCounts {
  /** Changes waiting to be sent. */
  pending: number;
  /** Changes the server refused, waiting for the person. */
  failed: number;
  /** Changes whose record someone else changed first, waiting for the person to choose. */
  conflict: number;
}

export async function countGroupQueue(database: IDBDatabase): Promise<GroupQueueCounts> {
  const queue = await loadGroupQueue(database);
  const conflict = queue.filter((item) => item.conflict !== undefined).length;
  const failed = queue.filter(
    (item) => item.conflict === undefined && item.rejection !== undefined,
  ).length;
  return { pending: queue.length - conflict - failed, failed, conflict };
}

/** Opens the database of one user for one operation and always closes it. */
export async function withGroupQueue<T>(
  userId: string,
  work: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const database = await openLocalDatabase(userId);
  try {
    return await work(database);
  } finally {
    database.close();
  }
}
