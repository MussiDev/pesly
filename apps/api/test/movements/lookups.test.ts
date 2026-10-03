import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAccountLookup } from '../../src/movements/infrastructure/db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../../src/movements/infrastructure/db/drizzle-category-lookup';
import { DrizzleRateLookup } from '../../src/movements/infrastructure/db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../../src/movements/infrastructure/db/drizzle-user-preferences';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, readScope, writeScope } from './db-fixtures';

let connection: DatabaseConnection;

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('DrizzleAccountLookup', () => {
  it('finds an own account and reports its archived state', async () => {
    const owner = await newUserId(connection.db);
    const active = await newAccount(connection.pool, owner);
    const archived = await newAccount(connection.pool, owner, true);
    const lookup = new DrizzleAccountLookup(connection.db);
    expect(await lookup.find(await writeScope(owner), active)).toEqual({
      id: active,
      archived: false,
      currency: 'ARS',
    });
    expect(await lookup.find(await readScope(owner), archived)).toEqual({
      id: archived,
      archived: true,
      currency: 'ARS',
    });
  });

  it('returns null for another owner account and for a missing id', async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const foreign = await newAccount(connection.pool, other);
    const lookup = new DrizzleAccountLookup(connection.db);
    expect(await lookup.find(await writeScope(owner), foreign)).toBeNull();
    expect(await lookup.find(await writeScope(owner), MISSING_ID)).toBeNull();
  });
});

describe('DrizzleCategoryLookup', () => {
  it('finds an own category with its kind and archived state', async () => {
    const owner = await newUserId(connection.db);
    const expense = await newCategory(connection.pool, owner, 'expense');
    const income = await newCategory(connection.pool, owner, 'income', true);
    const lookup = new DrizzleCategoryLookup(connection.db);
    expect(await lookup.find(await writeScope(owner), expense)).toEqual({
      id: expense,
      kind: 'expense',
      archived: false,
    });
    expect(await lookup.find(await writeScope(owner), income)).toEqual({
      id: income,
      kind: 'income',
      archived: true,
    });
  });

  it('returns null for another owner category and for a missing id', async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const foreign = await newCategory(connection.pool, other, 'expense');
    const lookup = new DrizzleCategoryLookup(connection.db);
    expect(await lookup.find(await writeScope(owner), foreign)).toBeNull();
    expect(await lookup.find(await writeScope(owner), MISSING_ID)).toBeNull();
  });
});

describe('DrizzleRateLookup', () => {
  beforeEach(async () => {
    await connection.pool.query(`delete from exchange_rates where rate_type in ('blue', 'mep')`);
  });

  it('returns the stored sell price as an exact bigint', async () => {
    await connection.pool.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ('blue', 14000000, 14123457, now(), now())`,
    );
    expect(await new DrizzleRateLookup(connection.db).latestSell('blue')).toEqual({
      sell: 14_123_457n,
    });
  });

  it('returns null when nothing is stored for the type', async () => {
    expect(await new DrizzleRateLookup(connection.db).latestSell('mep')).toBeNull();
  });
});

describe('DrizzleUserPreferences', () => {
  it('returns the stored zone and default rate type', async () => {
    const user = await newUserId(connection.db, { timeZone: 'America/Cordoba', rateType: 'blue' });
    expect(await new DrizzleUserPreferences(connection.db).find(user)).toEqual({
      timeZone: 'America/Cordoba',
      defaultRateType: 'blue',
    });
  });

  it('falls back to the default zone when the stored zone is invalid', async () => {
    const user = await newUserId(connection.db);
    await connection.pool.query(`update users set time_zone = 'Not/AZone' where id = $1`, [user]);
    expect((await new DrizzleUserPreferences(connection.db).find(user)).timeZone).toBe(
      'America/Argentina/Buenos_Aires',
    );
  });

  it('fails closed for a user that does not exist', async () => {
    await expect(new DrizzleUserPreferences(connection.db).find(MISSING_ID)).rejects.toThrow();
  });
});
