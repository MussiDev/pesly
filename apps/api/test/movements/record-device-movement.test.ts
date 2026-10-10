import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RetryableError } from '@pesly/shared';
import {
  CreateMovement,
  type CategorizedMovementInput,
} from '../../src/movements/application/create-movement';
import {
  DEFAULT_DEVICE_WRITE_LIMIT,
  RecordDeviceMovement,
} from '../../src/movements/application/record-device-movement';
import { MovementDateInFuture, MovementWriteRateLimited } from '../../src/movements/domain/errors';
import { DrizzleAccountLookup } from '../../src/movements/infrastructure/db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../../src/movements/infrastructure/db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import { DrizzleMovementWriteLimiter } from '../../src/movements/infrastructure/db/drizzle-movement-write-limiter';
import { DrizzleRateLookup } from '../../src/movements/infrastructure/db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../../src/movements/infrastructure/db/drizzle-user-preferences';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, writeScope } from './db-fixtures';
import {
  FakeRateLookup,
  FakeUserPreferences,
  InMemoryAccountLookup,
  InMemoryCategoryLookup,
  InMemoryMovementRepository,
  InMemoryMovementWriteLimiter,
  MutableClock,
  writeScopeFor,
} from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '5b8e2f40-7c19-4d63-a0e5-3f9b1c6d8a27';
const WINDOW_START = new Date('2026-10-02T12:00:00.000Z');

let movements: InMemoryMovementRepository;
let accounts: InMemoryAccountLookup;
let categories: InMemoryCategoryLookup;
let createMovement: CreateMovement;
let rates: FakeRateLookup;
let clock: MutableClock;
let limiter: InMemoryMovementWriteLimiter;
let record: RecordDeviceMovement;
let input: CategorizedMovementInput;
let reported: unknown[];

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  accounts = new InMemoryAccountLookup();
  categories = new InMemoryCategoryLookup();
  rates = new FakeRateLookup();
  rates.sells.set('blue', 14_000_000n);
  clock = new MutableClock(new Date('2026-10-02T12:00:10.000Z'));
  limiter = new InMemoryMovementWriteLimiter(() => clock.now());
  reported = [];
  createMovement = new CreateMovement({
    movements,
    accounts,
    categories,
    rates,
    preferences: new FakeUserPreferences(),
    clock,
  });
  record = new RecordDeviceMovement(
    {
      createMovement,
      movements,
      limiter,
      clock,
      reportReleaseFailure: (error) => reported.push(error),
    },
    3,
  );
  input = {
    type: 'expense',
    accountId: accounts.seed(ALICE),
    categoryId: categories.seed(ALICE, 'expense'),
    amount: 100n,
    occurredAt: new Date('2026-10-01T12:00:00.000Z'),
    rate: { source: 'manual', value: 14_000_000n },
  };
});

async function run(id = DEVICE_ID, data: CategorizedMovementInput = input, userId = ALICE) {
  return record.execute(await writeScopeFor(userId), id, data);
}

describe('RecordDeviceMovement', () => {
  it('creates the movement under the given id and says it was created (AC-03)', async () => {
    const result = await run();
    expect(result.created).toBe(true);
    expect(result.movement).toMatchObject({ id: DEVICE_ID, ownerId: ALICE });
    expect(movements.rows).toHaveLength(1);
  });

  it('returns the same movement the second time, says it was not created and keeps one row (AC-06)', async () => {
    const first = await run();
    const second = await run();
    expect(second.created).toBe(false);
    expect(second.movement).toEqual(first.movement);
    expect(movements.rows).toHaveLength(1);
  });

  it('returns the stored movement even when its account was archived since (AC-06)', async () => {
    const first = await run();
    accounts.setArchived(input.accountId, true);
    const replay = await run();
    expect(replay).toEqual({ movement: first.movement, created: false });
  });

  it('returns the first movement unchanged when the replay carries a different payload (AC-06)', async () => {
    const first = await run();
    const replay = await run(DEVICE_ID, { ...input, amount: 999_999n });
    expect(replay.created).toBe(false);
    expect(replay.movement).toEqual(first.movement);
    expect(replay.movement).toMatchObject({ amount: 100n });
    expect(movements.rows).toHaveLength(1);
  });

  it('spends no limit unit on a replay, even with the bucket exhausted (NFR-02)', async () => {
    const ids = [
      '6c9f3a51-8d2a-4e74-b1f6-4a0c2d7e9b38',
      '7d0a4b62-9e3b-4f85-82a7-5b1d3e8f0c49',
      '8e1b5c73-0f4c-4096-93b8-6c2e4f901d5a',
    ];
    for (const id of ids) await run(id);
    await expect(run('9f2c6d84-1a5d-41a7-a4c9-7d3f50a12e6b')).rejects.toBeInstanceOf(
      MovementWriteRateLimited,
    );
    const replay = await run(ids[0]);
    expect(replay.created).toBe(false);
    expect(limiter.countFor(ALICE, WINDOW_START, 'device')).toBe(3);
  });

  it('accepts 600 distinct ids in one window and rejects the 601st as rate limited with a retry time and a refund (NFR-02)', async () => {
    expect(DEFAULT_DEVICE_WRITE_LIMIT).toBe(600);
    const useCase = new RecordDeviceMovement({
      createMovement,
      movements,
      limiter,
      clock,
      reportReleaseFailure: (error) => reported.push(error),
    });
    const scope = await writeScopeFor(ALICE);
    for (let i = 0; i < DEFAULT_DEVICE_WRITE_LIMIT; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const outcome = await useCase.execute(scope, id, input);
      expect(outcome.created).toBe(true);
    }
    const error = await useCase
      .execute(scope, 'aaaaaaaa-0000-4000-8000-000000000601', input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MovementWriteRateLimited);
    expect(error).toBeInstanceOf(RetryableError);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 50 });
    expect(movements.rows).toHaveLength(DEFAULT_DEVICE_WRITE_LIMIT);
    expect(limiter.countFor(ALICE, WINDOW_START, 'device')).toBe(DEFAULT_DEVICE_WRITE_LIMIT);
  });

  it("answers 404 not found for another user's id and creates nothing (AC-06)", async () => {
    await run(DEVICE_ID, input, ALICE);
    const bobInput: CategorizedMovementInput = { ...input, amount: 777n };
    const error = await record
      .execute(await writeScopeFor(BOB), DEVICE_ID, bobInput)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResourceNotFound);
    expect(movements.rows).toHaveLength(1);
    expect(movements.rows[0]).toMatchObject({ ownerId: ALICE, amount: 100n });
    expect(limiter.countFor(BOB, WINDOW_START, 'device')).toBe(0);
  });

  it('refunds the unit and stores nothing on validation errors of buildNewMovement (invalid input)', async () => {
    const future = { ...input, occurredAt: new Date('2026-10-09T12:00:00.000Z') };
    await expect(run(DEVICE_ID, future)).rejects.toBeInstanceOf(MovementDateInFuture);
    expect(movements.rows).toHaveLength(0);
    expect(limiter.countFor(ALICE, WINDOW_START, 'device')).toBe(0);
  });

  it('reports a failing refund and lets the original error stand (invalid input)', async () => {
    const failure = new Error('refund down');
    limiter.releaseError = failure;
    const future = { ...input, occurredAt: new Date('2026-10-09T12:00:00.000Z') };
    await expect(run(DEVICE_ID, future)).rejects.toBeInstanceOf(MovementDateInFuture);
    expect(reported).toEqual([failure]);
  });

  it('refuses a write limit below 1 or a fraction (invalid input)', () => {
    const deps = { createMovement, movements, limiter, clock, reportReleaseFailure: () => {} };
    expect(() => new RecordDeviceMovement(deps, 0)).toThrow(RangeError);
    expect(() => new RecordDeviceMovement(deps, 1.5)).toThrow(RangeError);
  });
});

describe('RecordDeviceMovement with the real repository and limiter', () => {
  let connection: DatabaseConnection;

  beforeAll(() => {
    connection = createDatabase(testDatabaseUrl);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  function realUseCase(now: MutableClock, limit?: number): RecordDeviceMovement {
    const repository = new DrizzleMovementRepository(connection.db);
    return new RecordDeviceMovement(
      {
        createMovement: new CreateMovement({
          movements: repository,
          accounts: new DrizzleAccountLookup(connection.db),
          categories: new DrizzleCategoryLookup(connection.db),
          rates: new DrizzleRateLookup(connection.db),
          preferences: new DrizzleUserPreferences(connection.db),
          clock: now,
        }),
        movements: repository,
        limiter: new DrizzleMovementWriteLimiter(connection.db, now),
        clock: now,
        reportReleaseFailure: () => undefined,
      },
      limit,
    );
  }

  async function seeded(ownerId: string): Promise<CategorizedMovementInput> {
    return {
      type: 'expense',
      accountId: await newAccount(connection.pool, ownerId),
      categoryId: await newCategory(connection.pool, ownerId, 'expense'),
      amount: 100n,
      occurredAt: new Date('2026-10-01T12:00:00.000Z'),
      rate: { source: 'manual', value: 14_000_000n },
    };
  }

  it('leaves one row and answers the same id to two identical creates sent at once (NFR-03)', async () => {
    const owner = await newUserId(connection.db);
    const data = await seeded(owner);
    const scope = await writeScope(owner);
    const useCase = realUseCase(new MutableClock(new Date('2026-10-02T12:00:10.000Z')));

    const [one, two] = await Promise.all([
      useCase.execute(scope, DEVICE_ID.replace('5b8e', '5b8f'), data),
      useCase.execute(scope, DEVICE_ID.replace('5b8e', '5b8f'), data),
    ]);

    expect(one.movement.id).toBe(two.movement.id);
    expect([one.created, two.created].sort()).toEqual([false, true]);
    const stored = await connection.pool.query<{ n: string }>(
      'select count(*) as n from movements where owner_id = $1',
      [owner],
    );
    expect(stored.rows[0]?.n).toBe('1');
  });

  it('survives many identical creates sent at once with one row and a unit spent for the creation only (NFR-03)', async () => {
    const owner = await newUserId(connection.db);
    const data = await seeded(owner);
    const scope = await writeScope(owner);
    const clock = new MutableClock(new Date('2026-10-02T12:00:10.000Z'));
    const useCase = realUseCase(clock);
    const id = 'c3d4e5f6-0a1b-4c2d-8e3f-9a0b1c2d3e4f';

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => useCase.execute(scope, id, data)),
    );

    expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
    expect(new Set(outcomes.map((outcome) => outcome.movement.id))).toEqual(new Set([id]));
    const counters = await connection.pool.query<{ count: number }>(
      "select count from movement_rate_limits where owner_id = $1 and bucket = 'device'",
      [owner],
    );
    expect(counters.rows[0]?.count).toBe(1);
  });

  it("answers not found for another user's id and stores nothing for the caller (AC-06)", async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const ownerData = await seeded(owner);
    const otherData = await seeded(other);
    const useCase = realUseCase(new MutableClock(new Date('2026-10-02T12:00:10.000Z')));
    const id = 'd4e5f6a7-1b2c-4d3e-9f40-0b1c2d3e4f50';
    await useCase.execute(await writeScope(owner), id, ownerData);

    await expect(useCase.execute(await writeScope(other), id, otherData)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    const rows = await connection.pool.query<{ owner_id: string }>(
      'select owner_id from movements where id = $1',
      [id],
    );
    expect(rows.rows).toEqual([{ owner_id: owner }]);
  });
});
