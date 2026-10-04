import { randomUUID } from 'node:crypto';
import type { AccountCurrency, CategoryKind, RateType } from '@pesly/shared';
import type {
  CategorizedMovement,
  Movement,
  MovementFilters,
} from '../../src/movements/domain/movement';
import type { Clock } from '../../src/movements/application/ports/clock';
import type {
  MovementRepository,
  NewMovement,
} from '../../src/movements/application/ports/movement-repository';
import type {
  AccountLookup,
  AccountReference,
} from '../../src/movements/application/ports/account-lookup';
import type {
  CategoryLookup,
  CategoryReference,
} from '../../src/movements/application/ports/category-lookup';
import type { TagRepository } from '../../src/movements/application/ports/tag-repository';
import type { RateLookup } from '../../src/movements/application/ports/rate-lookup';
import type {
  UserPreferenceValues,
  UserPreferences,
} from '../../src/movements/application/ports/user-preferences';
import type {
  MovementWriteLimiter,
  WritePolicy,
  WriteReservation,
} from '../../src/movements/application/ports/movement-write-limiter';
import type { AccessScope } from '../../src/shared/access';

export { readScopeFor, writeScopeFor } from '../accounts/fakes';
export { MutableClock } from '../exchange-rates/fakes';
export type { Clock };

export class InMemoryMovementRepository implements MovementRepository {
  readonly rows: Movement[] = [];
  /** When set, `insert` throws it. */
  insertError: Error | null = null;
  /** When set, `list` throws it. */
  listError: Error | null = null;
  /** Every `list` call, so tests can assert what reached the port. */
  readonly listCalls: {
    scope: AccessScope;
    options: { limit: number; offset: number; filters: MovementFilters };
  }[] = [];

  async insert(scope: AccessScope<'write'>, data: NewMovement): Promise<Movement> {
    await Promise.resolve();
    if (this.insertError) throw this.insertError;
    const movement: Movement = {
      id: randomUUID(),
      ownerId: scope.userId,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.rows.length)),
      ...data,
      tags: data.tags ?? [],
    };
    this.rows.push(movement);
    return movement;
  }

  async list(
    scope: AccessScope,
    options: { limit: number; offset: number; filters: MovementFilters },
  ): Promise<{ items: Movement[]; total: number }> {
    await Promise.resolve();
    this.listCalls.push({ scope, options });
    if (this.listError) throw this.listError;
    const { filters } = options;
    // A parent category is not modelled here: the category filter is an exact match.
    const own = this.rows
      .filter((row) => row.ownerId === scope.userId)
      .filter(
        (row) =>
          filters.accountId === undefined ||
          row.accountId === filters.accountId ||
          ('destinationAccountId' in row && row.destinationAccountId === filters.accountId),
      )
      .filter(
        (row) =>
          filters.categoryId === undefined ||
          ('categoryId' in row && row.categoryId === filters.categoryId),
      )
      .filter((row) => filters.type === undefined || row.type === filters.type)
      .filter(
        (row) =>
          filters.tag === undefined ||
          row.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase()),
      )
      .filter((row) => filters.occurredFrom === undefined || row.occurredAt >= filters.occurredFrom)
      .filter(
        (row) => filters.occurredBefore === undefined || row.occurredAt < filters.occurredBefore,
      )
      .sort(
        (a, b) =>
          b.occurredAt.getTime() - a.occurredAt.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
    return { items: own.slice(options.offset, options.offset + options.limit), total: own.length };
  }

  async findById(scope: AccessScope, id: string): Promise<Movement | null> {
    await Promise.resolve();
    return this.rows.find((row) => row.id === id && row.ownerId === scope.userId) ?? null;
  }

  /** When set, `update` throws it. */
  updateError: Error | null = null;
  /** When set, `delete` throws it. */
  deleteError: Error | null = null;
  readonly updateCalls: { scope: AccessScope; id: string; data: NewMovement }[] = [];
  readonly deleteCalls: { scope: AccessScope; id: string }[] = [];

  async update(
    scope: AccessScope<'write'>,
    id: string,
    data: NewMovement,
  ): Promise<Movement | null> {
    await Promise.resolve();
    this.updateCalls.push({ scope, id, data });
    if (this.updateError) throw this.updateError;
    const index = this.rows.findIndex(
      (row) => row.id === id && row.ownerId === scope.userId && row.type === data.type,
    );
    const current = this.rows[index];
    if (current === undefined) return null;
    const replaced: Movement = {
      id: current.id,
      ownerId: current.ownerId,
      createdAt: current.createdAt,
      ...data,
      tags: data.tags ?? [],
    };
    this.rows[index] = replaced;
    return replaced;
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    await Promise.resolve();
    this.deleteCalls.push({ scope, id });
    if (this.deleteError) throw this.deleteError;
    const index = this.rows.findIndex((row) => row.id === id && row.ownerId === scope.userId);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }

  /** Test helper: stores a movement for any owner. */
  seed(ownerId: string, data: Partial<CategorizedMovement> = {}): Movement {
    const movement: CategorizedMovement = {
      id: randomUUID(),
      ownerId,
      type: 'expense',
      accountId: randomUUID(),
      categoryId: randomUUID(),
      amount: 100n,
      occurredAt: new Date('2026-10-01T12:00:00.000Z'),
      note: null,
      rate: 14_000_000n,
      rateSource: 'automatic',
      rateType: 'blue',
      tags: [],
      createdAt: new Date('2026-10-01T12:00:00.000Z'),
      ...data,
    };
    this.rows.push(movement);
    return movement;
  }
}

export class InMemoryTagRepository implements TagRepository {
  readonly calls: { scope: AccessScope; prefix: string; limit: number }[] = [];
  /** When set, `suggest` throws it. */
  suggestError: Error | null = null;
  private readonly names = new Map<string, string[]>();

  seed(ownerId: string, ...names: string[]): void {
    this.names.set(ownerId, [...(this.names.get(ownerId) ?? []), ...names]);
  }

  async suggest(scope: AccessScope, prefix: string, limit: number): Promise<string[]> {
    await Promise.resolve();
    this.calls.push({ scope, prefix, limit });
    if (this.suggestError) throw this.suggestError;
    const lowered = prefix.toLowerCase();
    return (this.names.get(scope.userId) ?? [])
      .filter((name) => name.toLowerCase().startsWith(lowered))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .slice(0, limit);
  }
}

export class InMemoryAccountLookup implements AccountLookup {
  private readonly rows = new Map<
    string,
    { ownerId: string; archived: boolean; currency: AccountCurrency }
  >();

  async find(scope: AccessScope, id: string): Promise<AccountReference | null> {
    await Promise.resolve();
    const row = this.rows.get(id);
    return row && row.ownerId === scope.userId
      ? { id, archived: row.archived, currency: row.currency }
      : null;
  }

  seed(ownerId: string, archived = false, currency: AccountCurrency = 'ARS'): string {
    const id = randomUUID();
    this.rows.set(id, { ownerId, archived, currency });
    return id;
  }

  setArchived(id: string, archived: boolean): void {
    const row = this.rows.get(id);
    if (row) row.archived = archived;
  }
}

export class InMemoryCategoryLookup implements CategoryLookup {
  private readonly rows = new Map<
    string,
    { ownerId: string; kind: CategoryKind; archived: boolean }
  >();

  async find(scope: AccessScope, id: string): Promise<CategoryReference | null> {
    await Promise.resolve();
    const row = this.rows.get(id);
    return row && row.ownerId === scope.userId
      ? { id, kind: row.kind, archived: row.archived }
      : null;
  }

  seed(ownerId: string, kind: CategoryKind, archived = false): string {
    const id = randomUUID();
    this.rows.set(id, { ownerId, kind, archived });
    return id;
  }

  setArchived(id: string, archived: boolean): void {
    const row = this.rows.get(id);
    if (row) row.archived = archived;
  }
}

export class FakeRateLookup implements RateLookup {
  readonly sells = new Map<RateType, bigint>();
  readonly calls: RateType[] = [];

  async latestSell(rateType: RateType): Promise<{ sell: bigint } | null> {
    await Promise.resolve();
    this.calls.push(rateType);
    const sell = this.sells.get(rateType);
    return sell === undefined ? null : { sell };
  }
}

export class FakeUserPreferences implements UserPreferences {
  values: UserPreferenceValues = {
    timeZone: 'America/Argentina/Buenos_Aires',
    defaultRateType: 'blue',
  };

  /** When set, `find` throws it. */
  findError: Error | null = null;
  findCalls = 0;

  async find(): Promise<UserPreferenceValues> {
    await Promise.resolve();
    this.findCalls += 1;
    if (this.findError) throw this.findError;
    return this.values;
  }
}

/** Fixed-window counter keyed by owner and window start, like the database adapter. */
export class InMemoryMovementWriteLimiter implements MovementWriteLimiter {
  readonly counts = new Map<string, number>();
  readonly recordCalls: string[] = [];
  readonly releaseCalls: Date[] = [];
  /** When set, `release` throws it. */
  releaseError: Error | null = null;
  /** When set, `release` throws it synchronously instead of returning a rejected promise. */
  releaseSyncError: Error | null = null;
  /** When set, `record` rejects with it. */
  recordError: Error | null = null;

  constructor(private readonly now: () => Date) {}

  async record(ownerId: string, policy: WritePolicy): Promise<WriteReservation> {
    await Promise.resolve();
    if (this.recordError) throw this.recordError;
    this.recordCalls.push(ownerId);
    const windowMs = policy.windowSeconds * 1000;
    const windowStart = new Date(Math.floor(this.now().getTime() / windowMs) * windowMs);
    const key = `${ownerId}|${windowStart.toISOString()}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { count, allowed: count <= policy.limit, windowStart };
  }

  release(ownerId: string, policy: WritePolicy, windowStart: Date): Promise<void> {
    if (this.releaseSyncError) throw this.releaseSyncError;
    return this.releaseAsync(ownerId, policy, windowStart);
  }

  private async releaseAsync(
    ownerId: string,
    _policy: WritePolicy,
    windowStart: Date,
  ): Promise<void> {
    await Promise.resolve();
    this.releaseCalls.push(windowStart);
    if (this.releaseError) throw this.releaseError;
    const key = `${ownerId}|${windowStart.toISOString()}`;
    this.counts.set(key, Math.max(0, (this.counts.get(key) ?? 0) - 1));
  }

  countFor(ownerId: string, windowStart: Date): number {
    return this.counts.get(`${ownerId}|${windowStart.toISOString()}`) ?? 0;
  }
}
