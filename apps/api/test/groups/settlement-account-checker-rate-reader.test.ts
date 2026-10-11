import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleSettlementAccountChecker } from '../../src/groups/infrastructure/accounts/drizzle-settlement-account-checker';
import { DrizzleRateReader } from '../../src/groups/infrastructure/rates/drizzle-rate-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('DrizzleSettlementAccountChecker', () => {
  it('accepts the own, non-archived account in the currency', async () => {
    const userId = await newUserId(connection.db);
    const accountId = await newAccount(connection.pool, userId, false, 'USD');

    const usable = await new DrizzleSettlementAccountChecker(connection.db).isUsable({
      userId,
      accountId,
      currency: 'USD',
    });

    expect(usable).toBe(true);
  });

  it('is false for another currency, an archived account, a missing one and another user (invalid)', async () => {
    const userId = await newUserId(connection.db);
    const stranger = await newUserId(connection.db);
    const ars = await newAccount(connection.pool, userId, false, 'ARS');
    const archived = await newAccount(connection.pool, userId, true, 'ARS');
    const checker = new DrizzleSettlementAccountChecker(connection.db);

    expect(await checker.isUsable({ userId, accountId: ars, currency: 'USD' })).toBe(false);
    expect(await checker.isUsable({ userId, accountId: archived, currency: 'ARS' })).toBe(false);
    expect(
      await checker.isUsable({
        userId,
        accountId: '00000000-0000-4000-8000-000000000000',
        currency: 'ARS',
      }),
    ).toBe(false);
    expect(await checker.isUsable({ userId: stranger, accountId: ars, currency: 'ARS' })).toBe(
      false,
    );
  });
});

describe('DrizzleRateReader', () => {
  it('reads the stored sell of the type and nothing for a type without a row (missing)', async () => {
    await connection.pool.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ('mep', 12900000, 13000000, now(), now())`,
    );
    const reader = new DrizzleRateReader(connection.db);

    expect(await reader.latestSell('mep')).toEqual({ sell: 13_000_000n });
    expect(await reader.latestSell('blue')).toBeNull();
  });
});
