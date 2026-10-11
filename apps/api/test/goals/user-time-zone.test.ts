import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleUserTimeZone } from '../../src/goals/infrastructure/db/drizzle-user-time-zone';
import { SystemClock } from '../../src/goals/infrastructure/system-clock';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let adapter: DrizzleUserTimeZone;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  adapter = new DrizzleUserTimeZone(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('DrizzleUserTimeZone', () => {
  it('returns the stored zone (AC-26)', async () => {
    const userId = await newUserId(connection.db, { timeZone: 'America/Argentina/Buenos_Aires' });

    expect(await adapter.timeZoneOf(userId)).toBe('America/Argentina/Buenos_Aires');
  });

  it('falls back to Buenos Aires for an invalid stored value', async () => {
    const userId = await newUserId(connection.db);
    await connection.pool.query('update users set time_zone = $2 where id = $1', [
      userId,
      'Mars/Olympus',
    ]);

    expect(await adapter.timeZoneOf(userId)).toBe('America/Argentina/Buenos_Aires');
  });

  it('fails closed for a missing user (sad path)', async () => {
    await expect(adapter.timeZoneOf('00000000-0000-4000-8000-000000000000')).rejects.toThrow();
  });
});

describe('SystemClock', () => {
  it('returns the current instant', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
