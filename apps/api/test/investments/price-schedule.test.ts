import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzlePriceSchedule } from '../../src/investments/infrastructure/db/drizzle-price-schedule';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { sqlState } from './fakes/price-db';

let connection: DatabaseConnection;
let schedule: DrizzlePriceSchedule;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  schedule = new DrizzlePriceSchedule(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const LEASE_MS = 300_000;
const INTERVAL_MS = 3_600_000;
const RETRY_MS = 900_000;
const T0 = new Date('2026-10-02T12:00:00.000Z');
const after = (from: Date, ms: number) => new Date(from.getTime() + ms);

interface SyncRow {
  next_attempt_at: Date;
  last_success_at: Date | null;
  consecutive_failures: number;
}

async function syncRows(): Promise<SyncRow[]> {
  const result = await connection.pool.query<SyncRow>(
    'select next_attempt_at, last_success_at, consecutive_failures from crypto_price_sync',
  );
  return result.rows;
}

async function claimed(now: Date) {
  const claim = await schedule.claim(now, LEASE_MS);
  if (!claim) throw new Error('the claim was expected to succeed');
  return claim;
}

async function usage(): Promise<Record<string, number>> {
  const result = await connection.pool.query<{ month: string; calls: number }>(
    'select month, calls from crypto_price_usage order by month',
  );
  return Object.fromEntries(result.rows.map((row) => [row.month, row.calls]));
}

describe('DrizzlePriceSchedule claim', () => {
  it('claims the first time, fails while the lease is open and succeeds once it has passed', async () => {
    expect(await schedule.claim(T0, LEASE_MS)).toEqual({
      lease: after(T0, LEASE_MS),
      consecutiveFailures: 0,
    });

    expect(await schedule.claim(after(T0, LEASE_MS - 1), LEASE_MS)).toBeNull();

    const reclaimAt = after(T0, LEASE_MS);
    expect(await schedule.claim(reclaimAt, LEASE_MS)).toEqual({
      lease: after(reclaimAt, LEASE_MS),
      consecutiveFailures: 0,
    });
    expect(await syncRows()).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous claims win', async () => {
    const other = new DrizzlePriceSchedule(connection.db);
    const results = await Promise.all([schedule.claim(T0, LEASE_MS), other.claim(T0, LEASE_MS)]);

    expect(results.filter((claim) => claim !== null)).toEqual([
      { lease: after(T0, LEASE_MS), consecutiveFailures: 0 },
    ]);
    expect(await syncRows()).toHaveLength(1);
  });

  it('returns the stored consecutive failures with the claim', async () => {
    await schedule.failed((await claimed(T0)).lease, T0, RETRY_MS);
    const secondAt = after(T0, RETRY_MS);
    const second = await claimed(secondAt);
    expect(second.consecutiveFailures).toBe(1);

    await schedule.failed(second.lease, secondAt, RETRY_MS);
    expect((await claimed(after(secondAt, RETRY_MS))).consecutiveFailures).toBe(2);
  });
});

describe('DrizzlePriceSchedule outcomes', () => {
  it('succeeded schedules the next attempt 60 minutes ahead and resets the failures', async () => {
    await schedule.failed((await claimed(T0)).lease, T0, RETRY_MS);
    const second = await claimed(after(T0, RETRY_MS));

    const doneAt = after(T0, RETRY_MS + 1000);
    await schedule.succeeded(second.lease, doneAt, INTERVAL_MS);

    expect(await syncRows()).toEqual([
      {
        next_attempt_at: after(doneAt, INTERVAL_MS),
        last_success_at: doneAt,
        consecutive_failures: 0,
      },
    ]);
  });

  it('failed schedules the retry ahead and counts the failures', async () => {
    await schedule.failed((await claimed(T0)).lease, T0, RETRY_MS);
    expect(await syncRows()).toEqual([
      { next_attempt_at: after(T0, RETRY_MS), last_success_at: null, consecutive_failures: 1 },
    ]);

    const retryAt = after(T0, RETRY_MS);
    await schedule.failed((await claimed(retryAt)).lease, retryAt, 2 * RETRY_MS);
    expect(await syncRows()).toEqual([
      {
        next_attempt_at: after(retryAt, 2 * RETRY_MS),
        last_success_at: null,
        consecutive_failures: 2,
      },
    ]);
  });

  it('deferred moves the next attempt without touching the failures or the last success', async () => {
    const first = await claimed(T0);
    await schedule.succeeded(first.lease, T0, INTERVAL_MS);
    const failAt = after(T0, INTERVAL_MS);
    await schedule.failed((await claimed(failAt)).lease, failAt, RETRY_MS);
    const retryAt = after(failAt, RETRY_MS);
    const claim = await claimed(retryAt);
    expect(claim.consecutiveFailures).toBe(1);

    await schedule.deferred(claim.lease, retryAt, INTERVAL_MS);

    expect(await syncRows()).toEqual([
      {
        next_attempt_at: after(retryAt, INTERVAL_MS),
        last_success_at: T0,
        consecutive_failures: 1,
      },
    ]);
  });

  it('a stale owner calling succeeded, failed or deferred changes nothing', async () => {
    const stale = await claimed(T0);
    const takeoverAt = after(T0, LEASE_MS + 1);
    expect(await claimed(takeoverAt)).toEqual({
      lease: after(takeoverAt, LEASE_MS),
      consecutiveFailures: 0,
    });
    const before = await syncRows();

    await schedule.succeeded(stale.lease, after(takeoverAt, 10), INTERVAL_MS);
    await schedule.failed(stale.lease, after(takeoverAt, 10), RETRY_MS);
    await schedule.deferred(stale.lease, after(takeoverAt, 10), INTERVAL_MS);

    expect(await syncRows()).toEqual(before);
  });
});

describe('DrizzlePriceSchedule reserveCall', () => {
  it('counts calls per month starting at one', async () => {
    expect(await schedule.reserveCall('2026-10')).toBe(true);
    expect(await schedule.reserveCall('2026-10')).toBe(true);
    expect(await schedule.reserveCall('2026-11')).toBe(true);

    expect(await usage()).toEqual({ '2026-10': 2, '2026-11': 1 });
  });

  it('gives exactly one success to two simultaneous reservations at 999 calls and refuses the 1,001st', async () => {
    await connection.pool.query(
      "insert into crypto_price_usage (month, calls) values ('2026-10', 999)",
    );
    const other = new DrizzlePriceSchedule(connection.db);

    const results = await Promise.all([
      schedule.reserveCall('2026-10'),
      other.reserveCall('2026-10'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await usage()).toEqual({ '2026-10': 1000 });
    expect(await schedule.reserveCall('2026-10')).toBe(false);
    expect(await usage()).toEqual({ '2026-10': 1000 });
  });

  it('refuses the 1,001st call of a month reached one reservation at a time', async () => {
    await connection.pool.query(
      "insert into crypto_price_usage (month, calls) values ('2026-10', 998)",
    );

    expect(await schedule.reserveCall('2026-10')).toBe(true);
    expect(await schedule.reserveCall('2026-10')).toBe(true);
    expect(await schedule.reserveCall('2026-10')).toBe(false);
    expect(await usage()).toEqual({ '2026-10': 1000 });
  });

  it('rejects a malformed month key', async () => {
    await expect(schedule.reserveCall('October')).rejects.toThrow();
    expect(await usage()).toEqual({});
  });
});

describe('the schedule tables constraints', () => {
  it('allows only the single schedule row and a non-negative failure count', async () => {
    const insert = (id: number, failures: number) =>
      sqlState(
        connection.pool,
        'insert into crypto_price_sync (id, next_attempt_at, consecutive_failures) values ($1, now(), $2)',
        [id, failures],
      );

    expect(await insert(2, 0)).toBe('23514');
    expect(await insert(1, -1)).toBe('23514');
    expect(await insert(1, 0)).toBeUndefined();
  });

  it('bounds the monthly counter between 0 and 1000', async () => {
    const insert = (calls: number) =>
      sqlState(
        connection.pool,
        "insert into crypto_price_usage (month, calls) values ('2026-10', $1)",
        [calls],
      );

    expect(await insert(1001)).toBe('23514');
    expect(await insert(-1)).toBe('23514');
    expect(await insert(1000)).toBeUndefined();
  });
});
