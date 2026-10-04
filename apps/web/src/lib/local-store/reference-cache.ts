import {
  accountResponseSchema,
  categoryResponseSchema,
  exchangeRateSchema,
  movementResponseSchema,
  profileResponseSchema,
  type AccountResponse,
  type CategoryResponse,
  type ExchangeRate,
  type MovementResponse,
  type ProfileResponse,
} from '@pesly/shared';
import { z } from 'zod';
import { MOVEMENTS_STORE, REFERENCE_STORE } from './database';
import type { LocalStore } from './stores';

/** How many movements the device keeps: the 100 most recent ones (PRD DISC-001-04a, FR-02). */
export const RECENT_MOVEMENTS_LIMIT = 100;

/** What the entry screen needs without a network: its options, the zone and the latest rates. */
export interface ReferenceData {
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  tags: string[];
  preferences: ProfileResponse['preferences'];
  rates: ExchangeRate[];
}

const referenceSchema = z.object({
  accounts: z.array(accountResponseSchema),
  categories: z.array(categoryResponseSchema),
  tags: z.array(z.string()),
  preferences: profileResponseSchema.shape.preferences,
  rates: z.array(exchangeRateSchema),
});

/** All five values go in one transaction, so a reader never sees accounts of one load and tags of another. */
export async function saveReferenceData(store: LocalStore, data: ReferenceData): Promise<void> {
  await store.putMany(REFERENCE_STORE, [
    ['accounts', data.accounts],
    ['categories', data.categories],
    ['tags', data.tags],
    ['preferences', data.preferences],
    ['rates', data.rates],
  ]);
}

/**
 * The copy saved by the last online load, or `null` when there is none or any part of it no longer
 * parses: a corrupt record counts as missing, it is never trusted and never thrown.
 */
export async function loadReferenceData(store: LocalStore): Promise<ReferenceData | null> {
  const [accounts, categories, tags, preferences, rates] = await Promise.all([
    store.get(REFERENCE_STORE, 'accounts'),
    store.get(REFERENCE_STORE, 'categories'),
    store.get(REFERENCE_STORE, 'tags'),
    store.get(REFERENCE_STORE, 'preferences'),
    store.get(REFERENCE_STORE, 'rates'),
  ]);
  const parsed = referenceSchema.safeParse({ accounts, categories, tags, preferences, rates });
  return parsed.success ? parsed.data : null;
}

function newestFirst(a: MovementResponse, b: MovementResponse): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** Replaces the saved movements with the 100 most recent of `movements`, newest first. */
export async function saveRecentMovements(
  store: LocalStore,
  movements: readonly MovementResponse[],
): Promise<void> {
  const recent = [...movements].sort(newestFirst).slice(0, RECENT_MOVEMENTS_LIMIT);
  await store.replaceAll(MOVEMENTS_STORE, recent);
}

/** The saved movements, newest first; a stored item that does not parse is left out. */
export async function loadRecentMovements(store: LocalStore): Promise<MovementResponse[]> {
  const stored = await store.getAll(MOVEMENTS_STORE, { newestFirst: true });
  const movements: MovementResponse[] = [];
  for (const item of stored) {
    const parsed = movementResponseSchema.safeParse(item);
    if (parsed.success) movements.push(parsed.data);
  }
  return movements;
}
