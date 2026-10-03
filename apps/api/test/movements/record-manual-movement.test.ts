import { beforeEach, describe, expect, it } from 'vitest';
import { RetryableError } from '@pesly/shared';
import {
  CreateMovement,
  type CategorizedMovementInput,
} from '../../src/movements/application/create-movement';
import { RecordManualMovement } from '../../src/movements/application/record-manual-movement';
import { MovementWriteRateLimited } from '../../src/movements/domain/errors';
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
const WINDOW_START = new Date('2026-10-02T12:00:00.000Z');

let movements: InMemoryMovementRepository;
let rates: FakeRateLookup;
let clock: MutableClock;
let limiter: InMemoryMovementWriteLimiter;
let createMovement: CreateMovement;
let record: RecordManualMovement;
let input: CategorizedMovementInput;
let reported: unknown[];

function reportReleaseFailure(error: unknown): void {
  reported.push(error);
}

beforeEach(() => {
  movements = new InMemoryMovementRepository();
  const accounts = new InMemoryAccountLookup();
  const categories = new InMemoryCategoryLookup();
  rates = new FakeRateLookup();
  rates.sells.set('blue', 14_000_000n);
  clock = new MutableClock(new Date('2026-10-02T12:00:10.000Z'));
  limiter = new InMemoryMovementWriteLimiter(() => clock.now());
  createMovement = new CreateMovement({
    movements,
    accounts,
    categories,
    rates,
    preferences: new FakeUserPreferences(),
    clock,
  });
  reported = [];
  record = new RecordManualMovement({ createMovement, limiter, clock, reportReleaseFailure }, 3);
  input = {
    type: 'expense',
    accountId: accounts.seed(ALICE),
    categoryId: categories.seed(ALICE, 'expense'),
    amount: 100n,
    occurredAt: new Date('2026-10-01T12:00:00.000Z'),
    rate: { source: 'automatic' },
  };
});

async function run() {
  return record.execute(await writeScopeFor(ALICE), input);
}

describe('RecordManualMovement', () => {
  it('stores up to the limit, rejects the next with retry seconds and stores nothing', async () => {
    for (let i = 0; i < 3; i++) await run();
    expect(movements.rows).toHaveLength(3);

    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MovementWriteRateLimited);
    expect(error).toBeInstanceOf(RetryableError);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 50 });
    expect(movements.rows).toHaveLength(3);
  });

  it('refunds the unit of an over-limit request', async () => {
    for (let i = 0; i < 3; i++) await run();
    await run().catch(() => undefined);
    await run().catch(() => undefined);
    expect(limiter.countFor(ALICE, WINDOW_START)).toBe(3);
  });

  it('accepts again in a new window', async () => {
    for (let i = 0; i < 3; i++) await run();
    await expect(run()).rejects.toBeInstanceOf(MovementWriteRateLimited);
    clock.advance(60_000);
    await expect(run()).resolves.toMatchObject({ ownerId: ALICE });
    expect(movements.rows).toHaveLength(4);
  });

  it('retry seconds are at least 1 and rounded up', async () => {
    for (let i = 0; i < 3; i++) await run();
    clock.current = new Date('2026-10-02T12:00:59.999Z');
    await expect(run()).rejects.toMatchObject({ retryAfterSeconds: 1 });
    clock.current = new Date('2026-10-02T12:00:00.000Z');
    await expect(run()).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it('refunds the unit when the creation fails', async () => {
    rates.sells.clear();
    await expect(run()).rejects.toMatchObject({ code: 'RATE_REQUIRED' });
    expect(limiter.countFor(ALICE, WINDOW_START)).toBe(0);

    movements.insertError = new Error('db down');
    rates.sells.set('blue', 1n);
    await expect(run()).rejects.toThrow('db down');
    expect(limiter.countFor(ALICE, WINDOW_START)).toBe(0);
  });

  it('keeps the unit of a saved movement', async () => {
    await run();
    expect(limiter.countFor(ALICE, WINDOW_START)).toBe(1);
    expect(limiter.releaseCalls).toHaveLength(0);
  });

  it('propagates the original creation error when release fails and reports the failure', async () => {
    rates.sells.clear();
    const failure = new Error('release failed');
    limiter.releaseError = failure;
    await expect(run()).rejects.toMatchObject({ code: 'RATE_REQUIRED' });
    expect(reported).toEqual([failure]);
  });

  it('propagates the original 429 when release fails and reports the failure', async () => {
    for (let i = 0; i < 3; i++) await run();
    const failure = new Error('release failed');
    limiter.releaseError = failure;
    await expect(run()).rejects.toBeInstanceOf(MovementWriteRateLimited);
    expect(reported).toEqual([failure]);
  });

  it('propagates the original error and reports when release throws synchronously', async () => {
    rates.sells.clear();
    const failure = new Error('sync release failed');
    limiter.releaseSyncError = failure;
    await expect(run()).rejects.toMatchObject({ code: 'RATE_REQUIRED' });
    expect(reported).toEqual([failure]);
  });

  it('propagates a rejected record and never releases', async () => {
    const failure = new Error('limiter down');
    limiter.recordError = failure;
    await expect(run()).rejects.toBe(failure);
    expect(limiter.releaseCalls).toHaveLength(0);
    expect(movements.rows).toHaveLength(0);
  });

  it('releases the window of the original reservation when the window rolls over during a failing creation', async () => {
    const original = new Date('2026-10-02T12:00:00.000Z');
    const failure = new Error('db down');
    movements.insertError = failure;
    const rolling = new Promise<void>((resolve) => {
      const insert = movements.insert.bind(movements);
      movements.insert = async (scope, data) => {
        clock.advance(60_000);
        resolve();
        return insert(scope, data);
      };
    });
    await expect(run()).rejects.toBe(failure);
    await rolling;
    expect(limiter.releaseCalls).toEqual([original]);
    expect(limiter.countFor(ALICE, original)).toBe(0);
  });

  it('caps the retry seconds at the window length when the clock is behind the window', async () => {
    const skewed = new MutableClock(new Date('2026-10-02T11:50:00.000Z'));
    const fixedLimiter = new InMemoryMovementWriteLimiter(() => new Date('2026-10-02T12:00:10Z'));
    const skewedRecord = new RecordManualMovement(
      { createMovement, limiter: fixedLimiter, clock: skewed, reportReleaseFailure },
      1,
    );
    const scope = await writeScopeFor(ALICE);
    await skewedRecord.execute(scope, input);
    await expect(skewedRecord.execute(scope, input)).rejects.toMatchObject({
      retryAfterSeconds: 60,
    });
  });

  it('CreateMovement called directly is never counted', async () => {
    const scope = await writeScopeFor(ALICE);
    for (let i = 0; i < 5; i++) await createMovement.execute(scope, input);
    expect(limiter.recordCalls).toHaveLength(0);
    expect(movements.rows).toHaveLength(5);
  });

  it('validates writeLimit as an integer of at least 1, default 60', async () => {
    const deps = { createMovement, limiter, clock, reportReleaseFailure };
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new RecordManualMovement(deps, bad)).toThrow(RangeError);
    }
    expect(() => new RecordManualMovement(deps, 1)).not.toThrow();

    const defaulted = new RecordManualMovement(deps);
    const scope = await writeScopeFor(ALICE);
    for (let i = 0; i < 60; i++) await defaulted.execute(scope, input);
    await expect(defaulted.execute(scope, input)).rejects.toBeInstanceOf(MovementWriteRateLimited);
  });

  it('has no provider dependency: constructor keys', () => {
    const keys = Object.keys((record as unknown as { deps: Record<string, unknown> }).deps).sort();
    expect(keys).toEqual(['clock', 'createMovement', 'limiter', 'reportReleaseFailure']);
  });
});
