import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleUserTimeZone } from '../../src/recurring/infrastructure/db/drizzle-user-time-zone';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('recurring DrizzleUserTimeZone', () => {
  it('returns the stored IANA zone of the user (AC-16)', async () => {
    const userId = await newUserId(connection.db, { timeZone: 'Asia/Tokyo' });
    expect(await new DrizzleUserTimeZone(connection.db).timeZoneOf(userId)).toBe('Asia/Tokyo');
  });

  it('falls back to Buenos Aires for a stored value that is not a zone', async () => {
    const userId = await newUserId(connection.db);
    await connection.pool.query("update users set time_zone = 'Not/AZone' where id = $1", [userId]);
    expect(await new DrizzleUserTimeZone(connection.db).timeZoneOf(userId)).toBe(
      'America/Argentina/Buenos_Aires',
    );
  });

  it('sad path: a missing user fails closed', async () => {
    await expect(
      new DrizzleUserTimeZone(connection.db).timeZoneOf('00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow();
  });
});
