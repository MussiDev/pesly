import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const EARLIER_TABLES = [
  'accounts',
  'auth_attempts',
  'categories',
  'category_defaults_seeded',
  'deletion_grants',
  'email_outbox',
  'exchange_rate_refresh_failures',
  'exchange_rate_sync',
  'exchange_rates',
  'oauth_states',
  'one_time_tokens',
  'recovery_codes',
  'sessions',
  'sign_in_challenges',
  'user_identities',
  'user_two_factor',
  'users',
];
const ALL_TABLES = [...EARLIER_TABLES, 'holdings', 'portfolios'].sort();
// Migrations applied after 0013 are rolled back first, so 0013 can be the one re-applied; the
// migrator replays everything not recorded, so they come back with it.
// Oldest first; rolled back newest first by journal `when`.
const LATER_MIGRATIONS = ['0014_movements', '0015_price_snapshots', '0016_transfers_exchanges'];
const PRICE_TABLES = [
  'crypto_market_prices',
  'crypto_price_refresh_failures',
  'crypto_price_sync',
  'crypto_price_usage',
  'portfolio_value_snapshots',
];
const LATER_TABLES = ['movement_rate_limits', 'movements', ...PRICE_TABLES];
const TABLES_AFTER_REAPPLY = [...ALL_TABLES, ...LATER_TABLES].sort();

/** Its own throwaway database: the other migration tests reset theirs, and none may clash. */
const migrationDatabaseUrl = (() => {
  const url = new URL(testDatabaseUrl);
  url.pathname = '/argent_investments_migration_test';
  return url.toString();
})();

const HOOK_TIMEOUT_MS = 30_000;

let client: pg.Client;

async function emptyTheDatabase(target: pg.Client): Promise<void> {
  await target.query('drop schema if exists drizzle cascade');
  await target.query('drop schema if exists public cascade');
  await target.query('create schema public');
}

beforeAll(async () => {
  await ensureTestDatabase(migrationDatabaseUrl);
  client = new pg.Client({ connectionString: migrationDatabaseUrl });
  await client.connect();
  await emptyTheDatabase(client);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await emptyTheDatabase(client);
  await client.end();
}, HOOK_TIMEOUT_MS);

async function publicTables(): Promise<string[]> {
  const result = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  return result.rows.map((row) => row.tablename);
}

async function sqlState(statement: string): Promise<string | undefined> {
  try {
    await client.query(statement);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function countOf(statement: string): Promise<number> {
  const result = await client.query<{ n: string }>(statement);
  return Number(result.rows[0]?.n);
}

async function indexDefinition(name: string): Promise<string | undefined> {
  const result = await client.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where schemaname = 'public' and indexname = $1",
    [name],
  );
  return result.rows[0]?.indexdef;
}

async function insertUser(email: string): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language) values ('${email}', 'h', 'UTC', 'es') returning id`,
  );
  return inserted.rows[0]?.id ?? '';
}

async function insertPortfolio(ownerId: string, name: string): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `insert into portfolios (owner_id, name) values ('${ownerId}', '${name}') returning id`,
  );
  return inserted.rows[0]?.id ?? '';
}

function insertHolding(
  portfolioId: string,
  ownerId: string,
  overrides: Record<string, string> = {},
): Promise<string | undefined> {
  const columns: Record<string, string> = {
    portfolio_id: `'${portfolioId}'`,
    owner_id: `'${ownerId}'`,
    ticker: "'AAPL'",
    instrument_name: "'Apple'",
    instrument_type: "'cedear'",
    quantity: '1000000000',
    valuation_currency: "'ARS'",
    ...overrides,
  };
  return sqlState(
    `insert into holdings (${Object.keys(columns).join(', ')}) values (${Object.values(columns).join(', ')})`,
  );
}

async function rollBackInvestments(): Promise<void> {
  for (const tag of [...LATER_MIGRATIONS].reverse()) {
    await client.query(await rollback(tag));
  }
  await client.query(await rollback('0013_investments'));
}

function rollback(tag: string): Promise<string> {
  return readFile(`${migrationsFolder}/rollback/${tag}.down.sql`, 'utf8');
}

async function appliedMigrations(): Promise<number> {
  return countOf('select count(*) as n from drizzle.__drizzle_migrations');
}

describe('0013_investments migration', () => {
  it('applies on a database that already holds the earlier migrations and their data', async () => {
    await runMigrations(migrationDatabaseUrl);
    const earlierCount = (await appliedMigrations()) - 1 - LATER_MIGRATIONS.length;
    await rollBackInvestments();
    expect(await publicTables()).toEqual(EARLIER_TABLES);
    expect(await appliedMigrations()).toBe(earlierCount);
    await insertUser('before@investments.test');

    await runMigrations(migrationDatabaseUrl);

    expect(await publicTables()).toEqual(TABLES_AFTER_REAPPLY);
    expect(await appliedMigrations()).toBe(earlierCount + 1 + LATER_MIGRATIONS.length);
    expect(
      await countOf("select count(*) as n from users where email = 'before@investments.test'"),
    ).toBe(1);
  });

  it('creates portfolios with a generated id, the name check, the owner cascade and its indexes', async () => {
    const ana = await insertUser('ana@investments.test');
    const portfolioId = await insertPortfolio(ana, 'Balanz');
    expect(portfolioId).toMatch(/^[0-9a-f-]{36}$/);
    const created = await client.query<{ created_at: Date }>(
      `select created_at from portfolios where id = '${portfolioId}'`,
    );
    expect(created.rows[0]?.created_at).toBeInstanceOf(Date);

    expect(await sqlState(`insert into portfolios (owner_id, name) values ('${ana}', '')`)).toBe(
      '23514',
    );
    expect(
      await sqlState(
        `insert into portfolios (owner_id, name) values ('${ana}', '${'x'.repeat(61)}')`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        `insert into portfolios (owner_id, name) values ('${ana}', '${'x'.repeat(60)}')`,
      ),
    ).toBeUndefined();
    expect(
      await sqlState(
        "insert into portfolios (owner_id, name) values (gen_random_uuid(), 'orphan')",
      ),
    ).toBe('23503');

    expect(await indexDefinition('portfolios_owner_id_idx')).toBe(
      'CREATE INDEX portfolios_owner_id_idx ON public.portfolios USING btree (owner_id)',
    );
    const unique = await client.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'portfolios' and indexdef like 'CREATE UNIQUE INDEX%' and indexname <> 'portfolios_pkey'",
    );
    expect(unique.rows.map((row) => row.indexdef)).toEqual([
      expect.stringMatching(/ON public\.portfolios USING btree \(id, owner_id\)$/),
    ]);

    await client.query(`delete from users where id = '${ana}'`);
    expect(await countOf('select count(*) as n from portfolios')).toBe(0);
  });

  it('creates holdings with bigint money columns, every check, the composite key and its indexes', async () => {
    const ana = await insertUser('ana2@investments.test');
    const bob = await insertUser('bob2@investments.test');
    const anaPortfolio = await insertPortfolio(ana, 'Balanz');

    const columns = await client.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'holdings'
          and column_name in ('quantity', 'total_cost', 'unit_price')
        order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'quantity', data_type: 'bigint' },
      { column_name: 'total_cost', data_type: 'bigint' },
      { column_name: 'unit_price', data_type: 'bigint' },
    ]);

    expect(await insertHolding(anaPortfolio, ana)).toBeUndefined();
    const checks: [string, Record<string, string>][] = [
      ['empty ticker', { ticker: "''" }],
      ['ticker of 21 characters', { ticker: `'${'T'.repeat(21)}'` }],
      ['empty instrument name', { instrument_name: "''" }],
      ['instrument name of 101 characters', { instrument_name: `'${'n'.repeat(101)}'` }],
      ['unknown type', { ticker: "'X1'", instrument_type: "'etf'" }],
      ['unknown currency', { ticker: "'X2'", valuation_currency: "'EUR'" }],
      ['quantity 0', { ticker: "'X3'", quantity: '0' }],
      ['negative quantity', { ticker: "'X4'", quantity: '-1' }],
      ['quantity above 10^18', { ticker: "'X5'", quantity: '1000000000000000001' }],
      ['total cost 0', { ticker: "'X6'", total_cost: '0' }],
      ['total cost above 10^15', { ticker: "'X7'", total_cost: '1000000000000001' }],
      [
        'unit price 0',
        { ticker: "'X8'", unit_price: '0', price_source: "'manual'", priced_at: 'now()' },
      ],
      [
        'unit price above 10^12',
        {
          ticker: "'X9'",
          unit_price: '1000000000001',
          price_source: "'manual'",
          priced_at: 'now()',
        },
      ],
      [
        'unknown price source',
        { ticker: "'Y1'", unit_price: '5', price_source: "'guess'", priced_at: 'now()' },
      ],
      ['price without source and date', { ticker: "'Y2'", unit_price: '5' }],
      ['source without price', { ticker: "'Y3'", price_source: "'manual'" }],
      ['date without price', { ticker: "'Y4'", priced_at: 'now()' }],
      [
        'crypto in ARS',
        { ticker: "'BTC'", instrument_type: "'crypto'", valuation_currency: "'ARS'" },
      ],
    ];
    for (const [label, overrides] of checks) {
      expect(await insertHolding(anaPortfolio, ana, overrides), label).toBe('23514');
    }
    expect(
      await insertHolding(anaPortfolio, ana, {
        ticker: "'BTC'",
        instrument_type: "'crypto'",
        valuation_currency: "'USD'",
        quantity: '1000000000000000000',
        total_cost: '1000000000000000',
        unit_price: '1000000000000',
        price_source: "'automatic'",
        priced_at: 'now()',
      }),
    ).toBeUndefined();

    // the holding can never carry another owner than its portfolio (composite key)
    expect(await insertHolding(anaPortfolio, bob, { ticker: "'ZZZ'" })).toBe('23503');
    // ticker is unique per portfolio ignoring case
    expect(await insertHolding(anaPortfolio, ana, { ticker: "'aapl'" })).toBe('23505');

    expect(await indexDefinition('holdings_portfolio_ticker_key')).toBe(
      'CREATE UNIQUE INDEX holdings_portfolio_ticker_key ON public.holdings USING btree (portfolio_id, lower(ticker))',
    );
    expect(await indexDefinition('holdings_owner_id_idx')).toBe(
      'CREATE INDEX holdings_owner_id_idx ON public.holdings USING btree (owner_id)',
    );

    const updatedAt = await client.query<{ created_at: Date; updated_at: Date }>(
      "select created_at, updated_at from holdings where ticker = 'AAPL'",
    );
    expect(updatedAt.rows[0]?.created_at).toBeInstanceOf(Date);
    expect(updatedAt.rows[0]?.updated_at).toBeInstanceOf(Date);

    // deleting a portfolio removes its holdings; deleting a user removes everything below it
    await client.query(`delete from portfolios where id = '${anaPortfolio}'`);
    expect(await countOf('select count(*) as n from holdings')).toBe(0);
    const again = await insertPortfolio(bob, 'Cocos');
    expect(await insertHolding(again, bob)).toBeUndefined();
    await client.query(`delete from users where id = '${bob}'`);
    expect(await countOf('select count(*) as n from holdings')).toBe(0);
  });

  it('is reverted by its rollback script, dropping both tables and keeping earlier data, and re-applies', async () => {
    const earlierCount = (await appliedMigrations()) - 1 - LATER_MIGRATIONS.length;

    await rollBackInvestments();

    expect(await publicTables()).toEqual(EARLIER_TABLES);
    expect(await appliedMigrations()).toBe(earlierCount);
    expect(
      await countOf("select count(*) as n from users where email = 'before@investments.test'"),
    ).toBe(1);

    await runMigrations(migrationDatabaseUrl);
    expect(await publicTables()).toEqual(TABLES_AFTER_REAPPLY);
    expect(await appliedMigrations()).toBe(earlierCount + 1 + LATER_MIGRATIONS.length);
  });
});
