import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleReportFilterReader } from '../../src/reports/infrastructure/db/drizzle-report-filter-reader';
import { DrizzleReportPreferences } from '../../src/reports/infrastructure/db/drizzle-report-preferences';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newUserId, readScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function newTag(ownerId: string, name: string): Promise<void> {
  await connection.pool.query('insert into tags (owner_id, name) values ($1, $2)', [ownerId, name]);
}

describe('DrizzleReportFilterReader', () => {
  it('owns the account of the caller and never one of another user or an unknown one', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const mine = await newAccount(connection.pool, ana);
    const hers = await newAccount(connection.pool, bea);
    const reader = new DrizzleReportFilterReader(connection.db);

    expect(await reader.ownsAccount(await readScope(ana), mine)).toBe(true);
    expect(await reader.ownsAccount(await readScope(ana), hers)).toBe(false);
    expect(
      await reader.ownsAccount(await readScope(ana), '00000000-0000-4000-8000-000000000000'),
    ).toBe(false);
    expect(await reader.ownsAccount(await readScope(bea), mine)).toBe(false);
  });

  it('matches a tag case-insensitively and never sees the tags of another user', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    await newTag(ana, 'vacations2026');
    await newTag(bea, 'secret-tag');
    const reader = new DrizzleReportFilterReader(connection.db);

    expect(await reader.ownsTag(await readScope(ana), 'Vacations2026')).toBe(true);
    expect(await reader.ownsTag(await readScope(ana), 'secret-tag')).toBe(false);
    expect(await reader.ownsTag(await readScope(bea), 'vacations2026')).toBe(false);
    expect(await reader.ownsTag(await readScope(bea), 'SECRET-TAG')).toBe(true);
  });

  it('treats LIKE wildcards in the name as plain characters', async () => {
    const ana = await newUserId(connection.db);
    await newTag(ana, 'abc');
    const reader = new DrizzleReportFilterReader(connection.db);

    expect(await reader.ownsTag(await readScope(ana), 'a%')).toBe(false);
    expect(await reader.ownsTag(await readScope(ana), 'a_c')).toBe(false);
  });
});

describe('DrizzleReportPreferences', () => {
  it('returns the stored display currency, default rate type and zone', async () => {
    const ana = await newUserId(connection.db, { timeZone: 'America/Cordoba', rateType: 'blue' });
    await connection.pool.query("update users set display_currency = 'USD' where id = $1", [ana]);

    expect(await new DrizzleReportPreferences(connection.db).preferencesOf(ana)).toEqual({
      displayCurrency: 'USD',
      defaultRateType: 'blue',
      timeZone: 'America/Cordoba',
    });
  });

  it('falls back to Buenos Aires for an invalid stored zone', async () => {
    const ana = await newUserId(connection.db);
    await connection.pool.query("update users set time_zone = 'Not/AZone' where id = $1", [ana]);

    expect((await new DrizzleReportPreferences(connection.db).preferencesOf(ana)).timeZone).toBe(
      'America/Argentina/Buenos_Aires',
    );
  });

  it('fails closed for a missing user', async () => {
    await expect(
      new DrizzleReportPreferences(connection.db).preferencesOf(
        '00000000-0000-4000-8000-000000000000',
      ),
    ).rejects.toThrow();
  });
});
