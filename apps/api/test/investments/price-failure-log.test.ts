import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceFailureCode } from '../../src/investments/domain/price-failure';
import { DrizzlePriceFailureLog } from '../../src/investments/infrastructure/db/drizzle-price-failure-log';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let log: DrizzlePriceFailureLog;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  log = new DrizzlePriceFailureLog(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

interface FailureRow {
  failed_at: Date;
  code: string;
  status_code: number | null;
  detail: string | null;
}

async function rows(): Promise<FailureRow[]> {
  const result = await connection.pool.query<FailureRow>(
    'select failed_at, code, status_code, detail from crypto_price_refresh_failures order by failed_at',
  );
  return result.rows;
}

const NUL = String.fromCharCode(0);
const AT = new Date('2026-10-02T12:00:00.000Z');

describe('DrizzlePriceFailureLog', () => {
  it('round-trips a record with code, status code and detail', async () => {
    await log.record({ at: AT, code: 'provider_rate_limited', statusCode: 429, detail: 'markets' });

    expect(await rows()).toEqual([
      { failed_at: AT, code: 'provider_rate_limited', status_code: 429, detail: 'markets' },
    ]);
  });

  it('stores nulls when the status code and detail are absent', async () => {
    await log.record({ at: AT, code: 'provider_timeout' });

    expect(await rows()).toEqual([
      { failed_at: AT, code: 'provider_timeout', status_code: null, detail: null },
    ]);
  });

  it('truncates a 300-character detail to 200 characters and keeps one of exactly 200', async () => {
    await log.record({ at: AT, code: 'provider_invalid_payload', detail: 'y'.repeat(300) });
    await log.record({ at: AT, code: 'provider_invalid_payload', detail: 'z'.repeat(200) });

    expect((await rows()).map((row) => row.detail).sort()).toEqual([
      'y'.repeat(200),
      'z'.repeat(200),
    ]);
  });

  it('counts code points, not UTF-16 units, when truncating', async () => {
    await log.record({
      at: AT,
      code: 'provider_invalid_payload',
      detail: '\u{1F4B0}'.repeat(250),
    });

    const [row] = await rows();
    expect(Array.from(row?.detail ?? '')).toHaveLength(200);
  });

  it('purgeOlderThan deletes only older rows and returns the count', async () => {
    const at = (offsetMs: number) => new Date(AT.getTime() + offsetMs);
    for (const offset of [-2000, -1, 0, 1000]) {
      await log.record({ at: at(offset), code: 'provider_unreachable' });
    }

    expect(await log.purgeOlderThan(AT)).toBe(2);
    expect((await rows()).map((row) => row.failed_at)).toEqual([AT, at(1000)]);
    expect(await log.purgeOlderThan(AT)).toBe(0);
  });

  it('rejects an unknown code', async () => {
    const unknownCode = 'nope' as PriceFailureCode;
    await expect(log.record({ at: AT, code: unknownCode })).rejects.toThrow();
    expect(await rows()).toEqual([]);
  });

  it('strips NUL characters from the detail instead of throwing', async () => {
    await log.record({ at: AT, code: 'provider_invalid_payload', detail: `a${NUL}b${NUL}` });

    expect((await rows()).map((row) => row.detail)).toEqual(['ab']);
  });

  it('stores a null status code when it is outside 100-599 instead of throwing', async () => {
    await log.record({ at: AT, code: 'provider_bad_status', statusCode: 99 });
    await log.record({ at: AT, code: 'provider_bad_status', statusCode: 600 });
    await log.record({ at: AT, code: 'provider_bad_status', statusCode: 12.5 });

    expect((await rows()).map((row) => row.status_code)).toEqual([null, null, null]);
  });
});
