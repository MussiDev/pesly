import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RATE_TYPES } from '@pesly/shared';
import { DrizzleRateRepository } from '../../src/exchange-rates/infrastructure/db/drizzle-rate-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { sampleQuotes } from './fakes';

let connection: DatabaseConnection;
let repository: DrizzleRateRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleRateRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await connection.pool.query('delete from exchange_rate_history');
  await connection.pool.query('delete from exchange_rates');
  await connection.pool.query('drop trigger if exists fail_history on exchange_rate_history');
});

interface HistoryRow {
  rate_type: string;
  rate_date: string;
  buy: string;
  sell: string;
}

async function history(): Promise<HistoryRow[]> {
  const result = await connection.pool.query<HistoryRow>(
    `select rate_type, to_char(rate_date, 'YYYY-MM-DD') as rate_date, buy::text, sell::text
       from exchange_rate_history order by rate_date, rate_type`,
  );
  return result.rows;
}

const bump = (delta: bigint) =>
  sampleQuotes().map((quote) => ({ ...quote, buy: quote.buy + delta, sell: quote.sell + delta }));

describe('rate history write path', () => {
  it('(AC-40) two refreshes on the same Argentina day leave one row per type with the second values', async () => {
    await repository.replaceAll(sampleQuotes(), new Date('2026-10-02T12:00:00.000Z'));
    const second = bump(5n);
    await repository.replaceAll(second, new Date('2026-10-02T20:00:00.000Z'));

    const rows = await history();
    expect(rows).toHaveLength(RATE_TYPES.length);
    for (const row of rows) {
      const quote = second.find((candidate) => candidate.rateType === row.rate_type);
      expect(row.rate_date).toBe('2026-10-02');
      expect(row.buy).toBe(quote?.buy.toString());
      expect(row.sell).toBe(quote?.sell.toString());
    }
  });

  it('a refresh on the next day adds a row, and 02:00 UTC counts as the previous Argentina day', async () => {
    await repository.replaceAll(sampleQuotes(), new Date('2026-10-02T12:00:00.000Z'));
    await repository.replaceAll(bump(1n), new Date('2026-10-03T12:00:00.000Z'));
    await repository.replaceAll(bump(2n), new Date('2026-10-04T02:00:00.000Z'));

    const rows = await history();
    expect(rows).toHaveLength(RATE_TYPES.length * 2);
    expect(new Set(rows.map((row) => row.rate_date))).toEqual(
      new Set(['2026-10-02', '2026-10-03']),
    );
    const first = rows.find((row) => row.rate_date === '2026-10-02' && row.rate_type === 'oficial');
    const second = rows.find(
      (row) => row.rate_date === '2026-10-03' && row.rate_type === 'oficial',
    );
    expect(first?.sell).toBe('10100000');
    // The 02:00 UTC fetch on the 4th landed on the 3rd and overwrote the 12:00 UTC one.
    expect(second?.sell).toBe('10100002');
  });

  it('a failing history upsert rolls back the exchange_rates upsert', async () => {
    await repository.replaceAll(sampleQuotes(), new Date('2026-10-02T12:00:00.000Z'));
    const before = await connection.pool.query('select * from exchange_rates order by rate_type');
    await connection.pool.query(
      `create or replace function fail_history_fn() returns trigger language plpgsql as
       $$ begin raise exception 'forced history failure'; end $$`,
    );
    await connection.pool.query(
      `create trigger fail_history before insert on exchange_rate_history
       for each row execute function fail_history_fn()`,
    );

    await expect(
      repository.replaceAll(bump(9n), new Date('2026-10-05T12:00:00.000Z')),
    ).rejects.toThrow();

    const after = await connection.pool.query('select * from exchange_rates order by rate_type');
    expect(after.rows).toEqual(before.rows);
    await connection.pool.query('drop trigger fail_history on exchange_rate_history');
    await connection.pool.query('drop function fail_history_fn()');
  });
});
