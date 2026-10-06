import {
  createMovementRequestSchema,
  impliedRate,
  movementResponseSchema,
  updateMovementRequestSchema,
  type CreateMovementRequest,
  type MovementResponse,
} from '@pesly/shared';
import { z } from 'zod';
import { QUEUE_STORE } from './database';
import type { LocalStore } from './stores';

/** A creation request, as the form builds it, that already carries the id the device chose for it. */
export type QueuedRequest = z.input<typeof createMovementRequestSchema> & { id: string };

/** An edit, as the edit form builds it for `PUT /movements/:id`. */
export type QueuedEditRequest = z.input<typeof updateMovementRequestSchema>;

/** The longest error code kept on a rejected item: a short code, never a message. */
const REJECTION_CODE_MAX_LENGTH = 64;

const rejectionSchema = z.object({ code: z.string().min(1).max(REJECTION_CODE_MAX_LENGTH) });

const commonFields = {
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  revision: z.number().int().min(0),
  rejection: rejectionSchema.optional(),
};

const queuedChangeShape = z
  .discriminatedUnion('operation', [
    z.object({
      operation: z.literal('create'),
      ...commonFields,
      request: createMovementRequestSchema,
    }),
    z.object({
      operation: z.literal('update'),
      ...commonFields,
      request: updateMovementRequestSchema,
      base: movementResponseSchema,
    }),
    z.object({
      operation: z.literal('delete'),
      ...commonFields,
      base: movementResponseSchema,
    }),
  ])
  .refine(
    (item) =>
      item.operation === 'create' ? item.request.id === item.id : item.base.id === item.id,
    { message: 'The record must carry the id of its movement' },
  );

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * What the queue stores for one movement that has a change the server does not have yet: one record
 * per movement id. `createdAt` is the instant of the first queued change (the send order),
 * `revision` grows with every local change, and `rejection` is set when the server refused the
 * change and it waits for the person (edit, retry or discard). A record written before changes
 * existed (no `operation`) is a creation at revision 0.
 */
export const queuedMovementSchema = z.preprocess(
  (raw) =>
    isRecord(raw) && raw.operation === undefined
      ? { ...raw, operation: 'create', revision: raw.revision ?? 0 }
      : raw,
  queuedChangeShape,
);
export type QueuedMovement = z.infer<typeof queuedChangeShape>;
export type QueuedOperation = QueuedMovement['operation'];
export type QueuedCreate = Extract<QueuedMovement, { operation: 'create' }>;
type QueuedUpdate = Extract<QueuedMovement, { operation: 'update' }>;
type EditRequest = QueuedUpdate['request'];

function parseRecord(raw: unknown): QueuedMovement | undefined {
  const parsed = queuedMovementSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** A record validated before it is written: one that does not fit throws, and nothing is stored. */
function checked(record: unknown): QueuedMovement {
  return queuedMovementSchema.parse(record);
}

/**
 * Saves one movement in the queue, in one transaction. A request that does not pass the shared
 * contract, or carries no id, is refused and nothing is stored.
 */
export async function enqueueMovement(
  store: LocalStore,
  request: QueuedRequest,
  now: Date = new Date(),
): Promise<void> {
  const record = checked({
    operation: 'create',
    id: request.id,
    request,
    createdAt: now.toISOString(),
    revision: 1,
  });
  await store.putItem(QUEUE_STORE, record);
}

/**
 * The queued changes, oldest first. A stored record that does not parse is left out but never
 * deleted: a later version of the app may still understand it.
 */
export async function loadQueue(store: LocalStore): Promise<QueuedMovement[]> {
  const raw = await store.getAll(QUEUE_STORE);
  return raw.flatMap((item) => {
    const parsed = parseRecord(item);
    return parsed === undefined ? [] : [parsed];
  });
}

export async function removeQueued(store: LocalStore, id: string): Promise<void> {
  await store.deleteItem(QUEUE_STORE, id);
}

/** A copy of the record with no rejection: any local change makes it a pending change again. */
function withoutRejection(record: QueuedMovement): QueuedMovement {
  const copy = { ...record };
  delete copy.rejection;
  return copy;
}

/** An edit's rate of `keep` means "what is already queued", when something is. */
function keptRate(edit: EditRequest, queued: object): EditRequest {
  if (edit.type !== 'expense' && edit.type !== 'income') return edit;
  if (edit.rate.source !== 'keep' || !('rate' in queued)) return edit;
  return { ...edit, rate: queued.rate } as EditRequest;
}

/** The creation request a queued create becomes once an edit is folded into it. */
function editedCreate(create: QueuedCreate['request'], edit: EditRequest): unknown {
  return { ...keptRate(edit, create), id: create.id };
}

/**
 * Queues an edit of a movement, in one transaction, folding it into whatever is already queued for
 * the same id (D2 of the spec): a queued create stays a create with the new values, a queued edit is
 * replaced, and an untouched rate keeps the rate already queued. A queued delete, an unreadable
 * record or a type that differs from the movement's answers `false` and changes nothing. Any change
 * clears a rejection: editing a failed change is how it is retried.
 */
export async function queueEdit(
  store: LocalStore,
  base: MovementResponse,
  request: QueuedEditRequest,
  now: Date = new Date(),
): Promise<boolean> {
  const edit = updateMovementRequestSchema.parse(request);
  if (edit.type !== base.type) return false;
  let written = false;
  await store.updateItem(QUEUE_STORE, base.id, (raw) => {
    if (raw === undefined) {
      written = true;
      return checked({
        operation: 'update',
        id: base.id,
        request: edit,
        base,
        createdAt: now.toISOString(),
        revision: 1,
      });
    }
    const current = parseRecord(raw);
    if (current === undefined || current.operation === 'delete') return undefined;
    const previous = current.request;
    if (previous.type !== edit.type) return undefined;
    written = true;
    const kept = withoutRejection(current);
    return checked({
      ...kept,
      request:
        current.operation === 'create'
          ? editedCreate(current.request, edit)
          : keptRate(edit, previous),
      revision: current.revision + 1,
    });
  });
  return written;
}

/**
 * Queues the deletion of a movement, in one transaction. Whatever was queued for it becomes a
 * delete, never a silent drop: a queued create may already be on the server (a lost answer), and its
 * delete answered "not found" settles it. The oldest base is kept. An unreadable record answers
 * `false` and is left alone.
 */
export async function queueDelete(
  store: LocalStore,
  base: MovementResponse,
  now: Date = new Date(),
): Promise<boolean> {
  let written = false;
  await store.updateItem(QUEUE_STORE, base.id, (raw) => {
    if (raw === undefined) {
      written = true;
      return checked({
        operation: 'delete',
        id: base.id,
        base,
        createdAt: now.toISOString(),
        revision: 1,
      });
    }
    const current = parseRecord(raw);
    if (current === undefined) return undefined;
    written = true;
    if (current.operation === 'delete') return undefined;
    return checked({
      operation: 'delete',
      id: current.id,
      base: current.operation === 'update' ? current.base : base,
      createdAt: current.createdAt,
      revision: current.revision + 1,
    });
  });
  return written;
}

/** Clears the rejection of a failed change so the next pass sends it again. */
export async function retryQueued(store: LocalStore, id: string): Promise<boolean> {
  let written = false;
  await store.updateItem(QUEUE_STORE, id, (raw) => {
    const current = parseRecord(raw);
    if (current?.rejection === undefined) return undefined;
    written = true;
    const kept = withoutRejection(current);
    return checked({ ...kept, revision: current.revision + 1 });
  });
  return written;
}

/** Drops a queued change: the server never got it, so its version stays the one shown. */
export async function discardQueued(store: LocalStore, id: string): Promise<boolean> {
  let written = false;
  await store.updateItem(QUEUE_STORE, id, (raw) => {
    if (raw === undefined) return undefined;
    written = true;
    return null;
  });
  return written;
}

/** The edit a create becomes when it changed while it was being sent (D3 of the spec). */
function createAsEdit(create: QueuedCreate['request']): unknown {
  const fields = { ...create };
  delete fields.id;
  if (
    (fields.type === 'expense' || fields.type === 'income') &&
    fields.rate.source === 'automatic'
  ) {
    // The server froze a rate when it stored the creation; asking again would freeze another one.
    return { ...fields, rate: { source: 'keep' } };
  }
  return fields;
}

/**
 * Settles a change the server accepted, in one transaction: the record goes only if it is still the
 * revision that was sent. A create that changed meanwhile becomes an edit of the stored movement
 * (`stored`); any other changed record waits for the next pass with its new values.
 */
export async function settleSent(
  store: LocalStore,
  id: string,
  revision: number,
  stored?: MovementResponse,
): Promise<void> {
  await store.updateItem(QUEUE_STORE, id, (raw) => {
    const current = parseRecord(raw);
    if (current === undefined) return undefined;
    if (current.revision === revision) return null;
    if (current.operation !== 'create' || stored === undefined) return undefined;
    return checked({
      operation: 'update',
      id: current.id,
      request: createAsEdit(current.request),
      base: stored,
      createdAt: current.createdAt,
      revision: current.revision,
    });
  });
}

/**
 * Flags a change the server refused; it is never deleted here. With a `revision`, a record that
 * changed since it was sent is left unflagged: the person already edited it. An id that is not
 * queued is ignored.
 */
export async function markRejected(
  store: LocalStore,
  id: string,
  code: string,
  revision?: number,
): Promise<void> {
  await store.updateItem(QUEUE_STORE, id, (raw) => {
    const current = parseRecord(raw);
    if (current === undefined) return undefined;
    if (revision !== undefined && current.revision !== revision) return undefined;
    return { ...current, rejection: { code: code.slice(0, REJECTION_CODE_MAX_LENGTH) } };
  });
}

export interface QueueCounts {
  /** Changes waiting to be sent. */
  pending: number;
  /** Changes the server refused, waiting for the person. */
  failed: number;
}

export async function countQueue(store: LocalStore): Promise<QueueCounts> {
  const queue = await loadQueue(store);
  const failed = queue.filter((item) => item.rejection !== undefined).length;
  return { pending: queue.length - failed, failed };
}

/**
 * The row the movement list shows for a queued movement. The currency of each account is needed to
 * read an exchange's implied rate (which of the two amounts is in pesos); without it the rate stays
 * empty rather than guessed.
 */
export function queuedToMovement(
  item: Pick<QueuedCreate, 'id' | 'request' | 'createdAt'>,
  currencies?: ReadonlyMap<string, string>,
): MovementResponse {
  const { request } = item;
  const base = {
    id: item.id,
    type: request.type,
    accountId: request.accountId,
    amount: request.amount,
    occurredAt: request.occurredAt,
    note: request.note ?? null,
    createdAt: item.createdAt,
  };

  if (request.type === 'transfer') {
    return {
      ...base,
      categoryId: null,
      destinationAccountId: request.destinationAccountId,
      destinationAmount: request.amount,
      rate: null,
      rateSource: null,
      rateType: null,
      tags: [],
    };
  }

  if (request.type === 'exchange') {
    return {
      ...base,
      categoryId: null,
      destinationAccountId: request.destinationAccountId,
      destinationAmount: request.destinationAmount,
      rate: impliedRateOf(request, currencies),
      rateSource: 'implied',
      rateType: null,
      tags: [],
    };
  }

  return {
    ...base,
    categoryId: request.categoryId,
    destinationAccountId: null,
    destinationAmount: null,
    rate: request.rate.source === 'manual' ? request.rate.value : null,
    rateSource: request.rate.source,
    rateType: null,
    tags: request.tags ?? [],
  };
}

/**
 * What the list shows for any queued change: a create as `queuedToMovement` builds it, an edit as
 * its base with the edited fields over it, and a delete as its base. An edit's rate is the base's
 * for `keep`, the typed one for `manual`, and empty for `automatic` until the server freezes it;
 * an omitted note or tags read as cleared, as `PUT` does. A request whose type differs from its
 * base shows the base: the server will refuse it and the reason will show.
 */
export function changeToMovement(
  record: QueuedMovement,
  currencies?: ReadonlyMap<string, string>,
): MovementResponse {
  if (record.operation === 'create') return queuedToMovement(record, currencies);
  if (record.operation === 'delete') return record.base;
  const { base, request } = record;
  if (request.type !== base.type) return base;
  const common = {
    ...base,
    accountId: request.accountId,
    amount: request.amount,
    occurredAt: request.occurredAt,
    note: request.note ?? null,
  };
  if (request.type === 'transfer') {
    return {
      ...common,
      destinationAccountId: request.destinationAccountId,
      destinationAmount: request.amount,
    };
  }
  if (request.type === 'exchange') {
    return {
      ...common,
      destinationAccountId: request.destinationAccountId,
      destinationAmount: request.destinationAmount,
      rate: impliedRateOf(request, currencies),
      rateSource: 'implied',
    };
  }
  const rate =
    request.rate.source === 'keep'
      ? { rate: base.rate, rateSource: base.rateSource, rateType: base.rateType }
      : {
          rate: request.rate.source === 'manual' ? request.rate.value : null,
          rateSource: request.rate.source,
          rateType: null,
        };
  return { ...common, categoryId: request.categoryId, tags: request.tags ?? [], ...rate };
}

function impliedRateOf(
  request: Pick<
    Extract<CreateMovementRequest, { type: 'exchange' }>,
    'accountId' | 'amount' | 'destinationAmount'
  >,
  currencies: ReadonlyMap<string, string> | undefined,
): string | null {
  const source = currencies?.get(request.accountId);
  if (source !== 'ARS' && source !== 'USD') return null;
  const amount = BigInt(request.amount);
  const destinationAmount = BigInt(request.destinationAmount);
  const [ars, usd] = source === 'ARS' ? [amount, destinationAmount] : [destinationAmount, amount];
  return impliedRate(ars, usd)?.toString() ?? null;
}
