import {
  createMovementRequestSchema,
  impliedRate,
  type CreateMovementRequest,
  type MovementResponse,
} from '@pesly/shared';
import { z } from 'zod';
import { QUEUE_STORE } from './database';
import type { LocalStore } from './stores';

/** A creation request, as the form builds it, that already carries the id the device chose for it. */
export type QueuedRequest = z.input<typeof createMovementRequestSchema> & { id: string };

/** The longest error code kept on a rejected item: a short code, never a message. */
const REJECTION_CODE_MAX_LENGTH = 64;

/**
 * What the queue stores for one unsent movement. `createdAt` is the instant of the save on the
 * device; `rejection` is set when the server refused the movement and the item stays for the person
 * to see (DISC-001-04c).
 */
export const queuedMovementSchema = z
  .object({
    id: z.uuid(),
    request: createMovementRequestSchema,
    createdAt: z.iso.datetime(),
    rejection: z.object({ code: z.string().min(1).max(REJECTION_CODE_MAX_LENGTH) }).optional(),
  })
  .refine((item) => item.request.id === item.id, {
    message: 'The request must carry the id of its record',
  });
export type QueuedMovement = z.infer<typeof queuedMovementSchema>;

/**
 * Saves one movement in the queue, in one transaction. A request that does not pass the shared
 * contract, or carries no id, is refused and nothing is stored.
 */
export async function enqueueMovement(
  store: LocalStore,
  request: QueuedRequest,
  now: Date = new Date(),
): Promise<void> {
  const record = queuedMovementSchema.parse({
    id: request.id,
    request,
    createdAt: now.toISOString(),
  });
  await store.putItem(QUEUE_STORE, record);
}

/**
 * The queued movements, oldest first. A stored record that does not parse is left out but never
 * deleted: a later version of the app may still understand it.
 */
export async function loadQueue(store: LocalStore): Promise<QueuedMovement[]> {
  const raw = await store.getAll(QUEUE_STORE);
  return raw.flatMap((item) => {
    const parsed = queuedMovementSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function removeQueued(store: LocalStore, id: string): Promise<void> {
  await store.deleteItem(QUEUE_STORE, id);
}

/** Flags a movement the server refused; it is never deleted here. An id that is not queued is ignored. */
export async function markRejected(store: LocalStore, id: string, code: string): Promise<void> {
  const parsed = queuedMovementSchema.safeParse(await store.get(QUEUE_STORE, id));
  if (!parsed.success) return;
  await store.putItem(QUEUE_STORE, {
    ...parsed.data,
    rejection: { code: code.slice(0, REJECTION_CODE_MAX_LENGTH) },
  });
}

/**
 * The row the movement list shows for a queued movement. The currency of each account is needed to
 * read an exchange's implied rate (which of the two amounts is in pesos); without it the rate stays
 * empty rather than guessed.
 */
export function queuedToMovement(
  item: Pick<QueuedMovement, 'id' | 'request' | 'createdAt'>,
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

function impliedRateOf(
  request: Extract<CreateMovementRequest, { type: 'exchange' }>,
  currencies: ReadonlyMap<string, string> | undefined,
): string | null {
  const source = currencies?.get(request.accountId);
  if (source !== 'ARS' && source !== 'USD') return null;
  const amount = BigInt(request.amount);
  const destinationAmount = BigInt(request.destinationAmount);
  const [ars, usd] = source === 'ARS' ? [amount, destinationAmount] : [destinationAmount, amount];
  return impliedRate(ars, usd)?.toString() ?? null;
}
