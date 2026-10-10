import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0015_price_snapshots';
// Journal-newer migrations go first: the migrator only replays what is newer than the last recorded.
const NEWER_TAGS = [
  '0016_transfers_exchanges',
  '0017_tags',
  '0018_device_write_limit',
  '0019_credit_cards',
  '0020_installments',
  '0021_installment_currency',
  '0022_card_statement_import_lines',
  '0023_recurring_payments',
];
const PRICE_TABLES = [
  'crypto_market_prices',
  'crypto_price_refresh_failures',
  'crypto_price_sync',
  'crypto_price_usage',
  'portfolio_value_snapshots',
];

/** Its own throwaway database: the other migration tests reset theirs, and none may clash. */
const migrationDatabaseUrl = (() => {
  const url = new URL(testDatabaseUrl);
  url.pathname = '/argent_price_migration_test';
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

async function priceTables(): Promise<string[]> {
  return (await publicTables()).filter((name) => PRICE_TABLES.includes(name));
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

function rollback(tag: string): Promise<string> {
  return readFile(`${migrationsFolder}/rollback/${tag}.down.sql`, 'utf8');
}

async function rollBackNewerAndOwn(): Promise<void> {
  for (const tag of [...NEWER_TAGS].reverse()) await client.query(await rollback(tag));
  await client.query(await rollback(TAG));
}

async function appliedMigrations(): Promise<number> {
  return countOf('select count(*) as n from drizzle.__drizzle_migrations');
}

async function insertUser(email: string): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language) values ('${email}', 'h', 'UTC', 'es') returning id`,
  );
  return inserted.rows[0]?.id ?? '';
}

describe('0015_price_snapshots migration', () => {
  it('applies on a database that already holds the earlier migrations and their data', async () => {
    await runMigrations(migrationDatabaseUrl);
    const earlierCount = (await appliedMigrations()) - 1 - NEWER_TAGS.length;
    await rollBackNewerAndOwn();
    expect(await priceTables()).toEqual([]);
    expect(await appliedMigrations()).toBe(earlierCount);
    await insertUser('before@prices.test');

    await runMigrations(migrationDatabaseUrl);

    expect(await priceTables()).toEqual(PRICE_TABLES);
    expect(await appliedMigrations()).toBe(earlierCount + 1 + NEWER_TAGS.length);
    expect(
      await countOf("select count(*) as n from users where email = 'before@prices.test'"),
    ).toBe(1);
  });

  it('creates the five tables with bigint money columns and no floating-point column', async () => {
    const columns = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])`,
      [PRICE_TABLES],
    );

    const types = Object.fromEntries(
      columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]),
    );
    expect(types['crypto_market_prices.unit_price']).toBe('bigint');
    expect(types['portfolio_value_snapshots.total_value']).toBe('bigint');
    expect(types['crypto_price_sync.consecutive_failures']).toBe('integer');
    expect(types['crypto_price_usage.calls']).toBe('integer');
    expect(
      columns.rows.filter((row) => ['real', 'double precision', 'numeric'].includes(row.data_type)),
    ).toEqual([]);
  });

  it('gives crypto_market_prices no foreign key and no owner column', async () => {
    expect(
      await countOf(
        "select count(*) as n from pg_constraint where contype = 'f' and conrelid = 'public.crypto_market_prices'::regclass",
      ),
    ).toBe(0);
    expect(
      await countOf(
        "select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'crypto_market_prices' and column_name like '%owner%'",
      ),
    ).toBe(0);
  });

  it('enforces the check constraints of every table', async () => {
    const checks: [string, string][] = [
      [
        'sync id other than 1',
        'insert into crypto_price_sync (id, next_attempt_at) values (2, now())',
      ],
      [
        'negative failures',
        'insert into crypto_price_sync (id, next_attempt_at, consecutive_failures) values (1, now(), -1)',
      ],
      [
        'malformed usage month',
        "insert into crypto_price_usage (month, calls) values ('2026-1', 1)",
      ],
      [
        'calls above 1000',
        "insert into crypto_price_usage (month, calls) values ('2026-10', 1001)",
      ],
      [
        'unknown failure code',
        "insert into crypto_price_refresh_failures (failed_at, code) values (now(), 'nope')",
      ],
      [
        'status code 99',
        "insert into crypto_price_refresh_failures (failed_at, code, status_code) values (now(), 'provider_bad_status', 99)",
      ],
      [
        'detail of 201 characters',
        `insert into crypto_price_refresh_failures (failed_at, code, detail) values (now(), 'provider_bad_status', '${'x'.repeat(201)}')`,
      ],
      [
        'uppercase symbol',
        "insert into crypto_market_prices (symbol, unit_price, priced_at) values ('BTC', 1, now())",
      ],
      [
        'symbol of 21 characters',
        `insert into crypto_market_prices (symbol, unit_price, priced_at) values ('${'a'.repeat(21)}', 1, now())`,
      ],
      [
        'price 0',
        "insert into crypto_market_prices (symbol, unit_price, priced_at) values ('btc', 0, now())",
      ],
      [
        'price above 10^12',
        "insert into crypto_market_prices (symbol, unit_price, priced_at) values ('btc', 1000000000001, now())",
      ],
    ];
    for (const [label, statement] of checks) {
      expect(await sqlState(statement), label).toBe('23514');
    }
    expect(
      await sqlState(
        "insert into crypto_market_prices (symbol, unit_price, priced_at) values ('btc', 1000000000000, now())",
      ),
    ).toBeUndefined();
    expect(
      await sqlState(
        `insert into crypto_price_refresh_failures (failed_at, code, status_code, detail) values (now(), 'provider_rate_limited', 429, '${'x'.repeat(200)}')`,
      ),
    ).toBeUndefined();
  });

  it('defines the snapshot keys: composite owner foreign key with cascade, composite primary key, checks', async () => {
    const ana = await insertUser('ana@prices.test');
    const bob = await insertUser('bob@prices.test');
    const portfolio = (
      await client.query<{ id: string }>(
        `insert into portfolios (owner_id, name) values ('${ana}', 'Balanz') returning id`,
      )
    ).rows[0]?.id;
    const snapshot = (owner: string, currency: string, total: string, date = '2026-10-01') =>
      `insert into portfolio_value_snapshots (portfolio_id, owner_id, snapshot_date, currency, total_value, taken_at)
       values ('${portfolio}', '${owner}', '${date}', '${currency}', ${total}, now())`;

    expect(await sqlState(snapshot(ana, 'ARS', '100'))).toBeUndefined();
    expect(await sqlState(snapshot(ana, 'USD', '100'))).toBeUndefined();
    expect(await sqlState(snapshot(ana, 'ARS', '100', '2026-10-02'))).toBeUndefined();
    expect(await sqlState(snapshot(ana, 'ARS', '100'))).toBe('23505');
    expect(await sqlState(snapshot(bob, 'ARS', '100', '2026-10-03'))).toBe('23503');
    expect(await sqlState(snapshot(ana, 'EUR', '100', '2026-10-03'))).toBe('23514');
    expect(await sqlState(snapshot(ana, 'ARS', '-1', '2026-10-03'))).toBe('23514');

    const foreignKey = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
        where contype = 'f' and conrelid = 'public.portfolio_value_snapshots'::regclass`,
    );
    expect(foreignKey.rows).toEqual([
      {
        definition:
          'FOREIGN KEY (portfolio_id, owner_id) REFERENCES portfolios(id, owner_id) ON DELETE CASCADE',
      },
    ]);

    await client.query(`delete from users where id = '${ana}'`);
    expect(await countOf('select count(*) as n from portfolio_value_snapshots')).toBe(0);
  });

  it('creates the indexes, including the partial expression index on holdings', async () => {
    expect(await indexDefinition('holdings_crypto_ticker_idx')).toMatch(
      /^CREATE INDEX holdings_crypto_ticker_idx ON public\.holdings USING btree \(lower\(ticker\)\) WHERE \(instrument_type = 'crypto'::text\)$/,
    );
    expect(await indexDefinition('crypto_price_refresh_failures_failed_at_idx')).toBe(
      'CREATE INDEX crypto_price_refresh_failures_failed_at_idx ON public.crypto_price_refresh_failures USING btree (failed_at)',
    );
    expect(await indexDefinition('portfolio_value_snapshots_owner_date_idx')).toBe(
      'CREATE INDEX portfolio_value_snapshots_owner_date_idx ON public.portfolio_value_snapshots USING btree (owner_id, snapshot_date)',
    );
    expect(await indexDefinition('portfolio_value_snapshots_pkey')).toBe(
      'CREATE UNIQUE INDEX portfolio_value_snapshots_pkey ON public.portfolio_value_snapshots USING btree (portfolio_id, snapshot_date, currency)',
    );
  });

  it('is reverted by its rollback script, dropping the tables and the index and keeping earlier data, and re-applies', async () => {
    const earlierCount = (await appliedMigrations()) - 1 - NEWER_TAGS.length;

    await rollBackNewerAndOwn();

    expect(await priceTables()).toEqual([]);
    expect(await indexDefinition('holdings_crypto_ticker_idx')).toBeUndefined();
    expect(await publicTables()).toEqual(
      expect.arrayContaining(['holdings', 'portfolios', 'users', 'exchange_rates']),
    );
    expect(await appliedMigrations()).toBe(earlierCount);
    expect(
      await countOf("select count(*) as n from users where email = 'before@prices.test'"),
    ).toBe(1);

    await runMigrations(migrationDatabaseUrl);
    expect(await priceTables()).toEqual(PRICE_TABLES);
    expect(await indexDefinition('holdings_crypto_ticker_idx')).toBeDefined();
    expect(await appliedMigrations()).toBe(earlierCount + 1 + NEWER_TAGS.length);
  });
});

describe('0015_price_snapshots migration journal order', () => {
  it('has one entry whose `when` is greater than that of every migration it was rebased onto', async () => {
    const raw = await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8');
    const entries = (JSON.parse(raw) as { entries: { tag: string; when: number }[] }).entries;
    const own = entries.find((entry) => entry.tag === TAG);
    const predecessors = [
      '0000_identity',
      '0001_outbox_hardening',
      '0002_credentials_version',
      '0003_outbox_retry',
      '0004_google_identity',
      '0005_two_factor',
      '0006_accounts',
      '0007_profile_display_name',
      '0009_categories',
      '0010_account_deletion',
      '0011_account_include_in_available',
      '0012_exchange_rates',
      '0013_investments',
      '0014_movements',
    ];

    expect(entries.filter((entry) => entry.tag === TAG)).toHaveLength(1);
    for (const tag of predecessors) {
      const earlier = entries.find((entry) => entry.tag === tag);
      expect(earlier, tag).toBeDefined();
      expect(own?.when ?? 0, tag).toBeGreaterThan(earlier?.when ?? Infinity);
    }
  });
});
