import { readFile } from 'node:fs/promises';
import { ACCOUNT_TYPES, defaultIncludeInAvailable, type AccountType } from '@pesly/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SET_0009 } from '../categories/fixtures/default-set-0009';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const ALL_MIGRATIONS = 20;
const TABLES_BEFORE_0004 = [
  'auth_attempts',
  'email_outbox',
  'one_time_tokens',
  'sessions',
  'users',
];
const TABLES_AT_0004 = [
  'auth_attempts',
  'email_outbox',
  'oauth_states',
  'one_time_tokens',
  'sessions',
  'user_identities',
  'users',
];
const ALL_TABLES = [
  'accounts',
  'auth_attempts',
  'categories',
  'category_defaults_seeded',
  'credit_card_statements',
  'credit_cards',
  'crypto_market_prices',
  'crypto_price_refresh_failures',
  'crypto_price_sync',
  'crypto_price_usage',
  'deletion_grants',
  'email_outbox',
  'exchange_rate_refresh_failures',
  'exchange_rate_sync',
  'exchange_rates',
  'holdings',
  'installment_purchases',
  'installments',
  'movement_rate_limits',
  'movement_tags',
  'movements',
  'oauth_states',
  'one_time_tokens',
  'portfolio_value_snapshots',
  'portfolios',
  'recovery_codes',
  'sessions',
  'sign_in_challenges',
  'tags',
  'user_identities',
  'user_two_factor',
  'users',
];
const CATEGORY_TABLES = ['categories', 'category_defaults_seeded'];
const INVESTMENT_TABLES = ['holdings', 'portfolios'];
const MOVEMENT_TABLES = ['movement_rate_limits', 'movements'];
const PRICE_TABLES = [
  'crypto_market_prices',
  'crypto_price_refresh_failures',
  'crypto_price_sync',
  'crypto_price_usage',
  'portfolio_value_snapshots',
];
const TAG_TABLES = ['movement_tags', 'tags'];
const CREDIT_CARD_TABLES = [
  'credit_card_statements',
  'credit_cards',
  'installment_purchases',
  'installments',
];
const EXCHANGE_RATE_TABLES = [
  'exchange_rate_refresh_failures',
  'exchange_rate_sync',
  'exchange_rates',
];
/** 0016_transfers_exchanges, 0015_price_snapshots, 0014_movements and then 0013_investments have the greatest journal `when`s: they are always rolled back first. */
const TABLES_WITHOUT_EXCHANGE_RATES = ALL_TABLES.filter(
  (name) =>
    !EXCHANGE_RATE_TABLES.includes(name) &&
    !INVESTMENT_TABLES.includes(name) &&
    !MOVEMENT_TABLES.includes(name) &&
    !PRICE_TABLES.includes(name) &&
    !TAG_TABLES.includes(name) &&
    !CREDIT_CARD_TABLES.includes(name),
);
const TABLES_BEFORE_0009 = ALL_TABLES.filter(
  (name) =>
    !CATEGORY_TABLES.includes(name) &&
    !EXCHANGE_RATE_TABLES.includes(name) &&
    !INVESTMENT_TABLES.includes(name) &&
    !MOVEMENT_TABLES.includes(name) &&
    !PRICE_TABLES.includes(name) &&
    !TAG_TABLES.includes(name) &&
    !CREDIT_CARD_TABLES.includes(name) &&
    name !== 'deletion_grants',
);
const TABLES_WITHOUT_ACCOUNTS_AND_CATEGORIES = TABLES_BEFORE_0009.filter(
  (name) => name !== 'accounts',
);

/** A throwaway database next to the test database, so the migration runs on a truly empty one. */
const emptyDatabaseUrl = (() => {
  const url = new URL(testDatabaseUrl);
  // Derived from the test database name so parallel worktrees on one server do not share it.
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_migration_test`;
  return url.toString();
})();

/**
 * Empties the throwaway database by dropping its schemas instead of the database itself: in
 * PostgreSQL 16 `drop database` waits for a checkpoint, which after a full test run flushes many
 * dirty buffers and could exceed the hook timeout (the flake this replaced).
 */
async function emptyTheDatabase(target: pg.Client): Promise<void> {
  await target.query('drop schema if exists drizzle cascade');
  await target.query('drop schema if exists public cascade');
  await target.query('create schema public');
}

/** Schema resets take milliseconds; the explicit timeout only guards a slow shared server. */
const HOOK_TIMEOUT_MS = 30_000;

let client: pg.Client;

beforeAll(async () => {
  await ensureTestDatabase(emptyDatabaseUrl);
  client = new pg.Client({ connectionString: emptyDatabaseUrl });
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

function rollback(tag: string): Promise<string> {
  return readFile(`${migrationsFolder}/rollback/${tag}.down.sql`, 'utf8');
}

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function indexDefinition(name: string): Promise<string | undefined> {
  const result = await client.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where schemaname = 'public' and indexname = $1",
    [name],
  );
  return result.rows[0]?.indexdef;
}

describe('0000_identity migration', () => {
  it('applies on an empty database and creates the identity tables', async () => {
    expect(await publicTables()).toEqual([]);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
  });

  it('creates the listed defaults, constraints and indexes', async () => {
    const inserted = await client.query<{
      id: string;
      default_rate_type: string;
      display_currency: string;
    }>(
      "insert into users (email, password_hash, time_zone, language) values ('ana@example.com', 'h', 'America/Cordoba', 'es') returning id, default_rate_type, display_currency",
    );
    const user = inserted.rows[0];
    expect(user).toMatchObject({ default_rate_type: 'mep', display_currency: 'ARS' });
    const userId = user?.id ?? '';

    // unique email
    expect(
      await sqlState(
        "insert into users (email, password_hash, time_zone, language) values ('ana@example.com', 'h', 'UTC', 'es')",
      ),
    ).toBe('23505');
    // check constraints
    for (const values of [
      "('x1@example.com', 'h', 'UTC', 'pt', 'mep', 'ARS')",
      "('x2@example.com', 'h', 'UTC', 'es', 'euro', 'ARS')",
      "('x3@example.com', 'h', 'UTC', 'es', 'mep', 'EUR')",
    ]) {
      expect(
        await sqlState(
          `insert into users (email, password_hash, time_zone, language, default_rate_type, display_currency) values ${values}`,
        ),
      ).toBe('23514');
    }
    expect(
      await sqlState(
        `insert into one_time_tokens (id, user_id, purpose, token_hash, expires_at) values (gen_random_uuid(), '${userId}', 'login', 'h', now())`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        "insert into auth_attempts (key, kind, window_start) values ('k', 'other', now())",
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'spam', 'es', '{}')",
      ),
    ).toBe('23514');
    // foreign keys cascade on user deletion
    await client.query(
      `insert into one_time_tokens (id, user_id, purpose, token_hash, expires_at) values (gen_random_uuid(), '${userId}', 'email_verification', 't1', now())`,
    );
    await client.query(
      `insert into sessions (id, user_id, family_id, refresh_token_hash, last_used_at) values (gen_random_uuid(), '${userId}', gen_random_uuid(), 'r1', now())`,
    );
    await client.query(`delete from users where id = '${userId}'`);
    const leftovers = await client.query(
      'select (select count(*) from one_time_tokens) + (select count(*) from sessions) as n',
    );
    expect(Number((leftovers.rows[0] as { n: string }).n)).toBe(0);

    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public'",
    );
    const definitions = indexes.rows.map((row) => row.indexdef);
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/UNIQUE INDEX \S+ ON public\.users USING btree \(email\)/),
        expect.stringMatching(
          /UNIQUE INDEX \S+ ON public\.one_time_tokens USING btree \(token_hash\)/,
        ),
        expect.stringMatching(
          /INDEX \S+ ON public\.one_time_tokens USING btree \(user_id, purpose\)/,
        ),
        expect.stringMatching(
          /UNIQUE INDEX \S+ ON public\.sessions USING btree \(refresh_token_hash\)/,
        ),
        expect.stringMatching(/INDEX \S+ ON public\.sessions USING btree \(user_id\)/),
        expect.stringMatching(/INDEX \S+ ON public\.sessions USING btree \(family_id\)/),
        expect.stringMatching(
          /UNIQUE INDEX \S+ ON public\.auth_attempts USING btree \(kind, key, window_start\)/,
        ),
        expect.stringMatching(
          /INDEX \S+ ON public\.email_outbox USING btree \(created_at\) WHERE \(sent_at IS NULL\)/,
        ),
      ]),
    );
  });

  it('is reverted by the rollback scripts (newest first), after which it can be applied again', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0005_two_factor'));
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));
    await client.query(await rollback('0002_credentials_version'));
    await client.query(await rollback('0001_outbox_hardening'));
    await client.query(await rollback('0000_identity'));
    expect(await publicTables()).toEqual([]);
    expect(await appliedMigrations()).toBe(0);

    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
  });
});

describe('0001_outbox_hardening migration', () => {
  it('adds the auth_attempts(window_start) index and the email_outbox language check', async () => {
    expect(await indexDefinition('auth_attempts_window_start_idx')).toMatch(
      /^CREATE INDEX auth_attempts_window_start_idx ON public\.auth_attempts USING btree \(window_start\)$/,
    );
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'pt', '{}')",
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'en', '{\"userId\": null}')",
      ),
    ).toBeUndefined();
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });

  it('is reverted by its rollback script (after the newer ones), leaving 0000 in place, and re-applies', async () => {
    await client.query('delete from email_outbox');
    // Newest first: drizzle only applies migrations newer than the last one recorded.
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0005_two_factor'));
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));
    await client.query(await rollback('0002_credentials_version'));
    await client.query(await rollback('0001_outbox_hardening'));

    expect(await indexDefinition('auth_attempts_window_start_idx')).toBeUndefined();
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'pt', '{}')",
      ),
    ).toBeUndefined();
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(1);

    await client.query('delete from email_outbox');
    await runMigrations(emptyDatabaseUrl);
    expect(await indexDefinition('auth_attempts_window_start_idx')).toBeDefined();
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function credentialsColumns(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public'
        and table_name in ('users', 'sessions')
        and column_name in ('credentials_version', 'password_changed_at')
      order by table_name, column_name`,
  );
  return result.rows;
}

describe('0002_credentials_version migration', () => {
  it('adds users.credentials_version, users.password_changed_at and sessions.credentials_version', async () => {
    expect(await credentialsColumns()).toEqual([
      {
        table_name: 'sessions',
        column_name: 'credentials_version',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      },
      {
        table_name: 'users',
        column_name: 'credentials_version',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      },
      {
        table_name: 'users',
        column_name: 'password_changed_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    const inserted = await client.query<{
      id: string;
      credentials_version: number;
      password_changed_at: Date | null;
    }>(
      "insert into users (email, password_hash, time_zone, language) values ('cv@example.com', 'h', 'UTC', 'es') returning id, credentials_version, password_changed_at",
    );
    expect(inserted.rows[0]).toMatchObject({ credentials_version: 0, password_changed_at: null });
    const session = await client.query<{ credentials_version: number }>(
      `insert into sessions (id, user_id, family_id, refresh_token_hash, last_used_at) values (gen_random_uuid(), '${inserted.rows[0]?.id ?? ''}', gen_random_uuid(), 'cv1', now()) returning credentials_version`,
    );
    expect(session.rows).toEqual([{ credentials_version: 0 }]);
  });

  it('is reverted by its rollback script (after the newer ones), keeping the data of the older columns, and re-applies', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0005_two_factor'));
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));
    await client.query(await rollback('0002_credentials_version'));

    expect(await credentialsColumns()).toEqual([]);
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(2);
    const kept = await client.query("select 1 from users where email = 'cv@example.com'");
    expect(kept.rowCount).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await credentialsColumns()).toHaveLength(3);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

async function nextAttemptColumn(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'email_outbox' and column_name = 'next_attempt_at'`,
  );
  return result.rows;
}

/** The two indexes added by 0010 are left out: this helper describes the indexes 0003 owns. */
async function outboxIndexes(): Promise<string[]> {
  const result = await client.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'email_outbox' and indexname not in ('email_outbox_pkey', 'email_outbox_payload_user_id_idx', 'email_outbox_to_email_idx') order by indexname",
  );
  return result.rows.map((row) => row.indexdef);
}

const PENDING_BY_CREATED_AT =
  'CREATE INDEX email_outbox_pending_idx ON public.email_outbox USING btree (created_at) WHERE (sent_at IS NULL)';
const PENDING_BY_SENT_AT =
  'CREATE INDEX email_outbox_pending_idx ON public.email_outbox USING btree (sent_at) WHERE (sent_at IS NULL)';

describe('0003_outbox_retry migration', () => {
  it('adds a nullable email_outbox.next_attempt_at without default and indexes pending rows by created_at', async () => {
    expect(await nextAttemptColumn()).toEqual([
      {
        table_name: 'email_outbox',
        column_name: 'next_attempt_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    expect(await outboxIndexes()).toEqual([PENDING_BY_CREATED_AT]);
    const inserted = await client.query<{ next_attempt_at: Date | null }>(
      "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'es', '{\"userId\": null}') returning next_attempt_at",
    );
    expect(inserted.rows).toEqual([{ next_attempt_at: null }]);
  });

  it('is reverted by its rollback script (after the newer ones), restoring the previous index and keeping the rows, and re-applies', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0005_two_factor'));
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));

    expect(await nextAttemptColumn()).toEqual([]);
    expect(await outboxIndexes()).toEqual([PENDING_BY_SENT_AT]);
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 17);
    const kept = await client.query("select 1 from email_outbox where kind = 'discard'");
    expect(kept.rowCount).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await nextAttemptColumn()).toHaveLength(1);
    expect(await outboxIndexes()).toEqual([PENDING_BY_CREATED_AT]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

async function passwordHashNullable(): Promise<string | undefined> {
  const result = await client.query<{ is_nullable: string }>(
    "select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'password_hash'",
  );
  return result.rows[0]?.is_nullable;
}

async function countOf(statement: string): Promise<number> {
  const result = await client.query<{ n: string }>(statement);
  return Number(result.rows[0]?.n);
}

describe('0004_google_identity migration', () => {
  it('applies on a database at 0003: password_hash nullable, user_identities, oauth_states and the google_start_ip kind', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0005_two_factor'));
    await client.query(await rollback('0004_google_identity'));
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 16);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await passwordHashNullable()).toBe('YES');
    const inserted = await client.query<{ id: string }>(
      "insert into users (email, time_zone, language, email_verified_at) values ('google@gmail.com', 'UTC', 'es', now()) returning id",
    );
    const userId = inserted.rows[0]?.id ?? '';
    const other = await client.query<{ id: string }>(
      "insert into users (email, password_hash, time_zone, language) values ('other@gmail.com', 'h', 'UTC', 'es') returning id",
    );
    const otherId = other.rows[0]?.id ?? '';
    expect(
      await sqlState(
        "insert into auth_attempts (key, kind, window_start) values ('ip', 'google_start_ip', now())",
      ),
    ).toBeUndefined();

    // user_identities: provider check, both unique constraints, cascade on user deletion
    const link = (user: string, provider: string, subject: string) =>
      sqlState(
        `insert into user_identities (user_id, provider, subject, email_authoritative) values ('${user}', '${provider}', '${subject}', true)`,
      );
    expect(await link(userId, 'google', 's1')).toBeUndefined();
    expect(await link(otherId, 'google', 's2')).toBeUndefined();
    expect(await link(otherId, 'apple', 's3')).toBe('23514');
    expect(await link(otherId, 'google', 's1')).toBe('23505');
    expect(await link(userId, 'google', 's4')).toBe('23505');
    await client.query(`delete from users where id = '${otherId}'`);
    expect(await countOf('select count(*) as n from user_identities')).toBe(1);

    // oauth_states: language check and the purge index on expires_at
    expect(
      await sqlState(
        "insert into oauth_states (state_hash, binding_hash, nonce_hash, code_verifier, time_zone, language, expires_at) values ('s', 'b', 'n', 'v', 'UTC', 'pt', now())",
      ),
    ).toBe('23514');
    expect(await indexDefinition('oauth_states_expires_at_idx')).toBe(
      'CREATE INDEX oauth_states_expires_at_idx ON public.oauth_states USING btree (expires_at)',
    );
  });

  it('has a rollback that fails while a password-less user exists, changing nothing', async () => {
    expect(await countOf('select count(*) as n from users where password_hash is null')).toBe(1);

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));

    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));

    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0005_two_factor'));
    expect(await sqlState(await rollback('0004_google_identity'))).toBe('23502');

    expect(await publicTables()).toEqual(TABLES_AT_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 15);
    expect(
      await countOf("select count(*) as n from auth_attempts where kind = 'google_start_ip'"),
    ).toBe(1);
  });

  it('is reverted by its rollback when no password-less user exists, removing google_start_ip rows, and re-applies', async () => {
    await client.query('delete from users where password_hash is null');
    await client.query(
      "insert into auth_attempts (key, kind, window_start) values ('ip', 'sign_in_ip', now())",
    );

    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0004_google_identity'));

    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 16);
    expect(await passwordHashNullable()).toBe('NO');
    expect(
      await countOf("select count(*) as n from auth_attempts where kind = 'google_start_ip'"),
    ).toBe(0);
    expect(await countOf("select count(*) as n from auth_attempts where kind = 'sign_in_ip'")).toBe(
      1,
    );
    expect(
      await sqlState(
        "insert into auth_attempts (key, kind, window_start) values ('ip2', 'google_start_ip', now())",
      ),
    ).toBe('23514');
    expect(await countOf("select count(*) as n from users where email = 'cv@example.com'")).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

const TWO_FACTOR_ATTEMPT_KINDS = [
  'second_factor_user_15m',
  'second_factor_user_24h',
  'two_factor_disable_user',
  'two_factor_disable_user_24h',
];
const TWO_FACTOR_OUTBOX_KINDS = ['two_factor_enabled', 'two_factor_disabled'];

async function insertUser(email: string): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language) values ('${email}', 'h', 'UTC', 'es') returning id`,
  );
  return inserted.rows[0]?.id ?? '';
}

function insertAttempt(kind: string): Promise<string | undefined> {
  return sqlState(
    `insert into auth_attempts (key, kind, window_start) values ('k-${kind}', '${kind}', now())`,
  );
}

function insertOutbox(kind: string): Promise<string | undefined> {
  return sqlState(
    `insert into email_outbox (id, kind, to_email, language, payload) values (gen_random_uuid(), '${kind}', 'a@example.com', 'es', '{"userId": null}')`,
  );
}

describe('0005_two_factor migration', () => {
  it('applies on a database at 0004: user_two_factor, recovery_codes, sign_in_challenges and the new kinds', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0005_two_factor'));
    expect(await publicTables()).toEqual(TABLES_AT_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 15);
    for (const kind of TWO_FACTOR_ATTEMPT_KINDS) expect(await insertAttempt(kind)).toBe('23514');
    for (const kind of TWO_FACTOR_OUTBOX_KINDS) expect(await insertOutbox(kind)).toBe('23514');

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    for (const kind of TWO_FACTOR_ATTEMPT_KINDS) expect(await insertAttempt(kind)).toBeUndefined();
    for (const kind of TWO_FACTOR_OUTBOX_KINDS) expect(await insertOutbox(kind)).toBeUndefined();
    expect(await insertAttempt('two_factor_other')).toBe('23514');
    expect(await insertOutbox('two_factor_other')).toBe('23514');

    const ana = await insertUser('ana@2fa.test');
    const bob = await insertUser('bob@2fa.test');
    // user_two_factor: one row per user, pending by default, step 0
    const settings = await client.query<{ enabled_at: Date | null; last_used_step: string }>(
      `insert into user_two_factor (user_id, secret_sealed) values ('${ana}', 's') returning enabled_at, last_used_step`,
    );
    expect(settings.rows).toEqual([{ enabled_at: null, last_used_step: '0' }]);
    expect(
      await sqlState(
        `insert into user_two_factor (user_id, secret_sealed) values ('${ana}', 's2')`,
      ),
    ).toBe('23505');
    expect(
      await sqlState(
        "insert into user_two_factor (user_id, secret_sealed) values (gen_random_uuid(), 's')",
      ),
    ).toBe('23503');
    // recovery_codes: generated id, unused by default
    const code = await client.query<{ id: string; used_at: Date | null }>(
      `insert into recovery_codes (user_id, code_hash) values ('${ana}', 'h') returning id, used_at`,
    );
    expect(code.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(code.rows[0]?.used_at).toBeNull();
    // sign_in_challenges: via and language checks, attempts default 0
    const challenge = (hash: string, via: string, language: string) =>
      sqlState(
        `insert into sign_in_challenges (token_hash, user_id, credentials_version, via, language, expires_at) values ('${hash}', '${ana}', 0, '${via}', '${language}', now())`,
      );
    expect(await challenge('c1', 'password', 'es')).toBeUndefined();
    expect(await challenge('c2', 'google', 'en')).toBeUndefined();
    expect(await challenge('c3', 'sms', 'es')).toBe('23514');
    expect(await challenge('c4', 'password', 'pt')).toBe('23514');
    expect(await challenge('c1', 'password', 'es')).toBe('23505');
    expect(await countOf('select sum(attempts) as n from sign_in_challenges')).toBe(0);

    // every new table cascades on user deletion
    await client.query(
      `insert into user_two_factor (user_id, secret_sealed) values ('${bob}', 's')`,
    );
    await client.query(`delete from users where id = '${ana}'`);
    expect(
      await countOf(
        'select (select count(*) from user_two_factor) + (select count(*) from recovery_codes) + (select count(*) from sign_in_challenges) as n',
      ),
    ).toBe(1);

    expect(await indexDefinition('recovery_codes_user_id_idx')).toBe(
      'CREATE INDEX recovery_codes_user_id_idx ON public.recovery_codes USING btree (user_id)',
    );
    expect(await indexDefinition('sign_in_challenges_expires_at_idx')).toBe(
      'CREATE INDEX sign_in_challenges_expires_at_idx ON public.sign_in_challenges USING btree (expires_at)',
    );
    expect(await indexDefinition('sign_in_challenges_user_id_idx')).toBe(
      'CREATE INDEX sign_in_challenges_user_id_idx ON public.sign_in_challenges USING btree (user_id)',
    );
  });

  it('is reverted by its rollback (restoring 0004 and deleting rows of the new kinds), and re-applies', async () => {
    const otherAttempts = "select count(*) as n from auth_attempts where kind = 'sign_in_ip'";
    const otherOutbox = "select count(*) as n from email_outbox where kind = 'discard'";
    await client.query(
      "insert into auth_attempts (key, kind, window_start) values ('ip-2fa', 'sign_in_ip', now())",
    );
    await client.query(
      "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'es', '{\"userId\": null}')",
    );
    const before = { attempts: await countOf(otherAttempts), outbox: await countOf(otherOutbox) };

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));

    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0006_accounts'));

    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0005_two_factor'));

    expect(await publicTables()).toEqual(TABLES_AT_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 15);
    const attemptKinds = TWO_FACTOR_ATTEMPT_KINDS.map((kind) => `'${kind}'`).join(', ');
    const outboxKinds = TWO_FACTOR_OUTBOX_KINDS.map((kind) => `'${kind}'`).join(', ');
    expect(
      await countOf(`select count(*) as n from auth_attempts where kind in (${attemptKinds})`),
    ).toBe(0);
    expect(
      await countOf(`select count(*) as n from email_outbox where kind in (${outboxKinds})`),
    ).toBe(0);
    expect(await countOf(otherAttempts)).toBe(before.attempts);
    expect(await countOf(otherOutbox)).toBe(before.outbox);
    for (const kind of TWO_FACTOR_ATTEMPT_KINDS) expect(await insertAttempt(kind)).toBe('23514');
    for (const kind of TWO_FACTOR_OUTBOX_KINDS) expect(await insertOutbox(kind)).toBe('23514');
    expect(await insertAttempt('google_start_ip')).toBeUndefined();
    expect(await countOf("select count(*) as n from users where email = 'bob@2fa.test'")).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

function insertAccount(owner: string, name: string): Promise<string | undefined> {
  return sqlState(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${owner}', '${name}', 'cash', 'ARS', 0, true)`,
  );
}

describe('0006_accounts migration', () => {
  it('applies on a database at 0005: the accounts table with its checks, defaults, indexes and immutability trigger', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0006_accounts'));
    expect(await publicTables()).not.toContain('accounts');
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 13);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    const ana = await insertUser('ana@accounts.test');
    const bob = await insertUser('bob@accounts.test');
    const inserted = await client.query<{ id: string; archived_at: Date | null; balance: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${ana}', 'Caja', 'cash', 'ARS', -1000000000000000, true) returning id, archived_at, opening_balance as balance`,
    );
    expect(inserted.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.rows[0]?.archived_at).toBeNull();
    expect(inserted.rows[0]?.balance).toBe('-1000000000000000');

    // unique lower(name) per owner; the same name for another owner is fine
    expect(await insertAccount(ana, 'CAJA')).toBe('23505');
    expect(await insertAccount(bob, 'caja')).toBeUndefined();
    // check constraints
    expect(await insertAccount(ana, '')).toBe('23514');
    expect(await insertAccount(ana, 'x'.repeat(51))).toBe('23514');
    expect(
      await sqlState(
        `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${ana}', 'T', 'crypto', 'ARS', 0, false)`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${ana}', 'C', 'cash', 'EUR', 0, true)`,
      ),
    ).toBe('23514');
    // opening balance bound: exactly plus or minus 10^15 is accepted, one more is not (FR-13)
    const withBalance = (name: string, balance: string) =>
      sqlState(
        `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${ana}', '${name}', 'cash', 'ARS', ${balance}, true)`,
      );
    expect(await withBalance('Max', '1000000000000000')).toBeUndefined();
    await client.query("delete from accounts where name = 'Max'");
    expect(await withBalance('Over', '1000000000000001')).toBe('23514');
    expect(await withBalance('Under', '-1000000000000001')).toBe('23514');
    expect(
      await countOf(
        "select count(*) as n from pg_constraint where conname = 'accounts_opening_balance_range_check'",
      ),
    ).toBe(1);
    // owner must exist
    expect(await insertAccount('00000000-0000-4000-8000-000000000000', 'Huerfana')).toBe('23503');
    // immutable fields
    expect(await sqlState(`update accounts set currency = 'USD' where owner_id = '${ana}'`)).toBe(
      '23514',
    );
    expect(await sqlState(`update accounts set type = 'savings' where owner_id = '${ana}'`)).toBe(
      '23514',
    );
    expect(
      await sqlState(`update accounts set owner_id = '${bob}' where owner_id = '${ana}'`),
    ).toBe('23514');
    expect(await sqlState(`update accounts set name = 'Otra' where owner_id = '${ana}'`)).toBe(
      undefined,
    );

    expect(await indexDefinition('accounts_owner_name_unique')).toBe(
      'CREATE UNIQUE INDEX accounts_owner_name_unique ON public.accounts USING btree (owner_id, lower(name))',
    );
    expect(await indexDefinition('accounts_owner_created_idx')).toBe(
      'CREATE INDEX accounts_owner_created_idx ON public.accounts USING btree (owner_id, created_at, id)',
    );
  });

  it('cascades on user deletion', async () => {
    const carla = await insertUser('carla@accounts.test');
    await insertAccount(carla, 'Banco');
    const before = await countOf('select count(*) as n from accounts');

    await client.query(`delete from users where id = '${carla}'`);

    expect(await countOf('select count(*) as n from accounts')).toBe(before - 1);
    expect(await countOf(`select count(*) as n from accounts where owner_id = '${carla}'`)).toBe(0);
  });

  it('is reverted by its rollback (dropping table, function and trigger), and re-applies', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0006_accounts'));

    expect(await publicTables()).not.toContain('accounts');
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 13);
    expect(
      await countOf(
        "select count(*) as n from pg_proc where proname = 'accounts_immutable_fields'",
      ),
    ).toBe(0);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(
      await countOf(
        "select count(*) as n from pg_proc where proname = 'accounts_immutable_fields'",
      ),
    ).toBe(1);
  });
});

async function displayNameColumn(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'display_name'`,
  );
  return result.rows;
}

describe('0007_profile_display_name migration', () => {
  it('applies on a database at 0005 with existing users, who keep a null display name', async () => {
    // 0016, 0015, 0014, 0013, 0012, 0011, 0010, 0009 and then 0006 have the latest journal `when`s, so they are the newest for the migrator: roll them back first.
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0007_profile_display_name'));
    expect(await displayNameColumn()).toEqual([]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 14);
    await insertUser('before@profile.test');

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await displayNameColumn()).toEqual([
      {
        table_name: 'users',
        column_name: 'display_name',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    expect(
      await countOf(
        "select count(*) as n from users where email = 'before@profile.test' and display_name is null",
      ),
    ).toBe(1);
    const named = (name: string) =>
      sqlState(`update users set display_name = '${name}' where email = 'before@profile.test'`);
    expect(await named('')).toBe('23514');
    expect(await named('x'.repeat(51))).toBe('23514');
    expect(await named('x'.repeat(50))).toBeUndefined();
  });

  it('is reverted by its rollback (dropping the column, keeping the users), and re-applies', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    await client.query(await rollback('0006_accounts'));
    await client.query(await rollback('0007_profile_display_name'));

    expect(await displayNameColumn()).toEqual([]);
    expect(await publicTables()).toEqual(TABLES_WITHOUT_ACCOUNTS_AND_CATEGORIES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 14);
    expect(
      await countOf("select count(*) as n from users where email = 'before@profile.test'"),
    ).toBe(1);
    expect(
      await sqlState(
        "insert into users (email, password_hash, time_zone, language, display_name) values ('late@profile.test', 'h', 'UTC', 'es', 'x')",
      ),
    ).toBe('42703');

    await runMigrations(emptyDatabaseUrl);
    expect(await displayNameColumn()).toHaveLength(1);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

interface CategoryShape {
  key: string | null;
  kind: string;
  parentKey: string | null;
  icon: string;
  color: string;
  name: string | null;
  archived: boolean;
}

function byKey(a: { key: string | null }, b: { key: string | null }): number {
  return (a.key ?? '') < (b.key ?? '') ? -1 : (a.key ?? '') > (b.key ?? '') ? 1 : 0;
}

async function categoriesOf(owner: string): Promise<CategoryShape[]> {
  const result = await client.query<CategoryShape>(
    `select c.default_key as key, c.kind, p.default_key as "parentKey", c.icon, c.color, c.name,
            c.archived_at is not null as archived
       from categories c left join categories p on p.id = c.parent_id
      where c.owner_id = '${owner}'`,
  );
  return result.rows.sort(byKey);
}

const FROZEN_SHAPES: CategoryShape[] = DEFAULT_SET_0009.map((entry) => ({
  key: entry.key,
  kind: entry.kind,
  parentKey: entry.parentKey,
  icon: entry.icon,
  color: entry.color,
  name: null,
  archived: false,
})).sort(byKey);

async function userIdOf(email: string): Promise<string> {
  const result = await client.query<{ id: string }>('select id from users where email = $1', [
    email,
  ]);
  return result.rows[0]?.id ?? '';
}

/** A digest per table that exists before 0009, to prove the backfill touches nothing else. */
async function otherTablesDigest(): Promise<string> {
  const parts: string[] = [];
  for (const table of TABLES_BEFORE_0009) {
    const result = await client.query<{ digest: string }>(
      `select coalesce(md5(string_agg(t::text, ',' order by t::text)), '') as digest from "${table}" t`,
    );
    parts.push(`${table}:${result.rows[0]?.digest ?? ''}`);
  }
  return parts.join('|');
}

async function backfillStatement(): Promise<string> {
  const file = await readFile(`${migrationsFolder}/0009_categories.sql`, 'utf8');
  const statement = file
    .split('--> statement-breakpoint')
    .find((part) => part.includes('-- backfill default categories'));
  if (!statement) throw new Error('0009_categories.sql has no "-- backfill default categories"');
  return statement;
}

async function oauthStateColumns(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'oauth_states'
        and column_name in ('purpose', 'user_id', 'session_family_id')
      order by column_name`,
  );
  return result.rows;
}

function insertState(hash: string, columns = '', values = ''): Promise<string | undefined> {
  return sqlState(
    `insert into oauth_states (state_hash, binding_hash, nonce_hash, code_verifier, time_zone, language, expires_at${columns}) values ('${hash}', 'b', 'n', 'v', 'UTC', 'es', now()${values})`,
  );
}

function insertGrant(hash: string, userId: string): Promise<string | undefined> {
  return sqlState(
    `insert into deletion_grants (token_hash, user_id, session_family_id, credentials_version, expires_at) values ('${hash}', '${userId}', gen_random_uuid(), 0, now())`,
  );
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

async function readJournal(): Promise<JournalEntry[]> {
  const raw = await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

const INVESTMENTS_TAG = '0013_investments';
const MOVEMENTS_TAG = '0014_movements';
const PRICE_SNAPSHOTS_TAG = '0015_price_snapshots';
const TRANSFERS_EXCHANGES_TAG = '0016_transfers_exchanges';
const TAGS_TAG = '0017_tags';

/**
 * True when `tag` exists and has a `when` greater than every entry in `entries` listed as its
 * predecessors: the order drizzle applies by. It says nothing about migrations added later.
 */
function isAfterPredecessors(
  entries: readonly JournalEntry[],
  tag: string,
  predecessors: readonly string[],
): boolean {
  const mine = entries.find((entry) => entry.tag === tag);
  if (!mine) return false;
  return entries
    .filter((entry) => predecessors.includes(entry.tag))
    .every((entry) => entry.when < mine.when);
}

describe('0009_categories migration', () => {
  it('backfills the default set for existing users on a database at 0007 and changes no other row', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));
    expect(await publicTables()).toEqual(TABLES_BEFORE_0009);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 12);
    await insertUser('ana@categories.test');
    await insertUser('bob@categories.test');
    await insertUser('carla@categories.test');
    const users = await countOf('select count(*) as n from users');
    const digest = await otherTablesDigest();

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(users).toBeGreaterThanOrEqual(3);
    expect(await otherTablesDigest()).toBe(digest);
    expect(FROZEN_SHAPES).toHaveLength(33);
    const owners = await client.query<{ id: string }>('select id from users');
    for (const owner of owners.rows) {
      expect(await categoriesOf(owner.id)).toEqual(FROZEN_SHAPES);
      expect(
        await countOf(
          `select count(*) as n from category_defaults_seeded where owner_id = '${owner.id}'`,
        ),
      ).toBe(1);
    }
    expect(await countOf('select count(*) as n from categories')).toBe(users * 33);
    expect(await countOf('select count(*) as n from category_defaults_seeded')).toBe(users);
  });

  it('creates no duplicate when the backfill runs again, and never gives back a deleted default or reseeds a marked user', async () => {
    const statement = await backfillStatement();
    const total = await countOf('select count(*) as n from categories');

    await client.query(statement);
    expect(await countOf('select count(*) as n from categories')).toBe(total);

    const ana = await userIdOf('ana@categories.test');
    const bob = await userIdOf('bob@categories.test');
    const carla = await userIdOf('carla@categories.test');
    await client.query(
      `delete from categories where owner_id = '${ana}' and default_key = 'other-income'`,
    );
    // children first: the parent foreign key is ON DELETE RESTRICT
    await client.query(
      `delete from categories where owner_id = '${bob}' and parent_id is not null`,
    );
    await client.query(`delete from categories where owner_id = '${bob}'`);

    await client.query(statement);

    const anaKeys = (await categoriesOf(ana)).map((row) => row.key);
    expect(anaKeys).toHaveLength(32);
    expect(anaKeys).not.toContain('other-income');
    expect(await categoriesOf(bob)).toEqual([]);
    expect(
      await countOf(`select count(*) as n from category_defaults_seeded where owner_id = '${bob}'`),
    ).toBe(1);
    expect(await categoriesOf(carla)).toEqual(FROZEN_SHAPES);

    // a user created after the migration has no marker: only that user gets the set
    const dave = await insertUser('dave@categories.test');
    await client.query(statement);
    expect(await categoriesOf(dave)).toEqual(FROZEN_SHAPES);
    expect(await categoriesOf(bob)).toEqual([]);
    expect((await categoriesOf(ana)).length).toBe(32);
    await client.query(statement);
    expect(await categoriesOf(dave)).toEqual(FROZEN_SHAPES);
  });

  it('cascades on user deletion', async () => {
    const dave = await userIdOf('dave@categories.test');

    await client.query(`delete from users where id = '${dave}'`);

    expect(await countOf(`select count(*) as n from categories where owner_id = '${dave}'`)).toBe(
      0,
    );
    expect(
      await countOf(
        `select count(*) as n from category_defaults_seeded where owner_id = '${dave}'`,
      ),
    ).toBe(0);
  });

  it('has the listed constraints, indexes and guard trigger', async () => {
    const checks = await client.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'categories'::regclass and contype = 'c' order by conname",
    );
    expect(checks.rows.map((row) => row.conname)).toEqual([
      'categories_color_length_check',
      'categories_default_key_length_check',
      'categories_icon_length_check',
      'categories_key_or_name_check',
      'categories_kind_check',
      'categories_name_length_check',
    ]);
    const foreignKeys = await client.query<{ conname: string; def: string }>(
      "select conname, pg_get_constraintdef(oid) as def from pg_constraint where contype = 'f' and conrelid in ('categories'::regclass, 'category_defaults_seeded'::regclass) order by conname",
    );
    expect(foreignKeys.rows.map((row) => row.def)).toEqual([
      'FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE',
      'FOREIGN KEY (parent_id, owner_id, kind) REFERENCES categories(id, owner_id, kind) ON DELETE RESTRICT',
      'FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE',
    ]);
    const unique = await client.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'categories'::regclass and contype = 'u'",
    );
    expect(unique.rows.map((row) => row.def)).toEqual(['UNIQUE (id, owner_id, kind)']);

    expect(await indexDefinition('categories_owner_default_key_unique')).toBe(
      'CREATE UNIQUE INDEX categories_owner_default_key_unique ON public.categories USING btree (owner_id, default_key) WHERE (default_key IS NOT NULL)',
    );
    expect(await indexDefinition('categories_owner_name_unique')).toBe(
      "CREATE UNIQUE INDEX categories_owner_name_unique ON public.categories USING btree (owner_id, kind, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE (name IS NOT NULL)",
    );
    expect(await indexDefinition('categories_owner_kind_parent_idx')).toBe(
      'CREATE INDEX categories_owner_kind_parent_idx ON public.categories USING btree (owner_id, kind, parent_id)',
    );
    expect(await indexDefinition('categories_owner_created_idx')).toBe(
      'CREATE INDEX categories_owner_created_idx ON public.categories USING btree (owner_id, created_at, id)',
    );
    const triggers = await client.query<{ tgname: string }>(
      "select tgname from pg_trigger where tgrelid = 'categories'::regclass and not tgisinternal",
    );
    expect(triggers.rows).toEqual([{ tgname: 'categories_guard_trigger' }]);
  });

  it('is reverted by its rollback (dropping both tables, the function and the trigger, keeping the users), and re-applies', async () => {
    const users = await countOf('select count(*) as n from users');

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));

    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0010_account_deletion'));
    await client.query(await rollback('0009_categories'));

    expect(await publicTables()).toEqual(TABLES_BEFORE_0009);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 12);
    expect(
      await countOf("select count(*) as n from pg_proc where proname = 'categories_guard'"),
    ).toBe(0);
    expect(await countOf('select count(*) as n from users')).toBe(users);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(
      await countOf("select count(*) as n from pg_proc where proname = 'categories_guard'"),
    ).toBe(1);
    expect(await countOf('select count(*) as n from category_defaults_seeded')).toBe(users);
  });

  it('has a later journal when than 0000 to 0007, and the check fails when the order is reversed', async () => {
    const entries = (await readJournal()).filter(
      (entry) =>
        entry.tag !== MOVEMENTS_TAG &&
        entry.tag !== TRANSFERS_EXCHANGES_TAG &&
        entry.tag !== TAGS_TAG &&
        entry.tag !== '0018_device_write_limit' &&
        entry.tag !== '0019_credit_cards' &&
        entry.tag !== '0020_installments' &&
        entry.tag !== INVESTMENTS_TAG &&
        entry.tag !== PRICE_SNAPSHOTS_TAG &&
        entry.tag !== '0010_account_deletion' &&
        entry.tag !== '0011_account_include_in_available' &&
        entry.tag !== '0012_exchange_rates',
    );
    const predecessors = entries
      .filter((entry) => entry.tag !== '0009_categories')
      .map((entry) => entry.tag);

    expect(entries.map((entry) => entry.tag)).toContain('0009_categories');
    expect(isAfterPredecessors(entries, '0009_categories', predecessors)).toBe(true);
    expect(entries.find((entry) => entry.tag === '0009_categories')?.when).toBeGreaterThan(
      1790895423195,
    );

    const whens = entries.map((entry) => entry.when).sort((a, b) => a - b);
    const reversed = entries.map((entry, index) => ({
      idx: entry.idx,
      tag: entry.tag,
      when: whens[entries.length - 1 - index] ?? 0,
    }));
    expect(isAfterPredecessors(reversed, '0009_categories', predecessors)).toBe(false);
    expect(isAfterPredecessors(entries, 'no-such-migration', predecessors)).toBe(false);
  });
});

const BOUND_COLUMNS = ', purpose, user_id, session_family_id';

describe('0010_account_deletion migration', () => {
  it('applies on top of the earlier ones with existing OAuth states, which keep the purpose sign_in', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));
    await client.query(await rollback('0010_account_deletion'));
    expect(await publicTables()).not.toContain('deletion_grants');
    expect(await oauthStateColumns()).toEqual([]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 11);
    await insertState('legacy');

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await oauthStateColumns()).toEqual([
      {
        table_name: 'oauth_states',
        column_name: 'purpose',
        data_type: 'text',
        is_nullable: 'NO',
        column_default: "'sign_in'::text",
      },
      {
        table_name: 'oauth_states',
        column_name: 'session_family_id',
        data_type: 'uuid',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        table_name: 'oauth_states',
        column_name: 'user_id',
        data_type: 'uuid',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    expect(
      await countOf(
        "select count(*) as n from oauth_states where state_hash = 'legacy' and purpose = 'sign_in' and user_id is null and session_family_id is null",
      ),
    ).toBe(1);
  });

  it('enforces the purpose rules and cascades from the user on oauth_states and deletion_grants', async () => {
    const ana = await insertUser('ana@deletion.test');
    const missing = '00000000-0000-4000-8000-000000000000';

    expect(
      await insertState('d1', BOUND_COLUMNS, `, 'delete_account', '${ana}', gen_random_uuid()`),
    ).toBeUndefined();
    expect(await insertState('d2', ', purpose', ", 'delete_account'")).toBe('23514');
    expect(await insertState('d3', ', purpose, user_id', `, 'delete_account', '${ana}'`)).toBe(
      '23514',
    );
    expect(await insertState('d4', ', purpose, user_id', `, 'sign_in', '${ana}'`)).toBe('23514');
    expect(await insertState('d5', ', session_family_id', ', gen_random_uuid()')).toBe('23514');
    expect(await insertState('d6', ', purpose', ", 'other'")).toBe('23514');
    expect(
      await insertState('d7', BOUND_COLUMNS, `, 'delete_account', '${missing}', gen_random_uuid()`),
    ).toBe('23503');

    expect(await insertGrant('g1', ana)).toBeUndefined();
    expect(await insertGrant('g1', ana)).toBe('23505');
    expect(await insertGrant('g2', missing)).toBe('23503');
    expect(
      await countOf('select count(*) as n from deletion_grants where created_at is not null'),
    ).toBe(1);

    await client.query(`delete from users where id = '${ana}'`);

    expect(await countOf("select count(*) as n from oauth_states where state_hash = 'd1'")).toBe(0);
    expect(await countOf('select count(*) as n from deletion_grants')).toBe(0);
    expect(
      await countOf("select count(*) as n from oauth_states where state_hash = 'legacy'"),
    ).toBe(1);
  });

  it('adds the indexes of the grant table and the two email_outbox lookups', async () => {
    expect(await indexDefinition('deletion_grants_user_id_idx')).toBe(
      'CREATE INDEX deletion_grants_user_id_idx ON public.deletion_grants USING btree (user_id)',
    );
    expect(await indexDefinition('deletion_grants_expires_at_idx')).toBe(
      'CREATE INDEX deletion_grants_expires_at_idx ON public.deletion_grants USING btree (expires_at)',
    );
    expect(await indexDefinition('email_outbox_payload_user_id_idx')).toMatch(
      /^CREATE INDEX email_outbox_payload_user_id_idx ON public\.email_outbox USING btree \(\(\(payload ->> 'userId'::text\)\)\)$/,
    );
    expect(await indexDefinition('email_outbox_to_email_idx')).toBe(
      'CREATE INDEX email_outbox_to_email_idx ON public.email_outbox USING btree (to_email) WHERE (to_email IS NOT NULL)',
    );
  });

  it('is reverted by its rollback (deleting delete_account states, keeping sign_in ones and the users), and re-applies', async () => {
    const bob = await insertUser('bob@deletion.test');
    await insertState('d8', BOUND_COLUMNS, `, 'delete_account', '${bob}', gen_random_uuid()`);
    await insertGrant('g3', bob);

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0011_account_include_in_available'));

    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback('0010_account_deletion'));

    expect(await publicTables()).not.toContain('deletion_grants');
    expect(await oauthStateColumns()).toEqual([]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 11);
    expect(await countOf("select count(*) as n from oauth_states where state_hash = 'd8'")).toBe(0);
    expect(
      await countOf("select count(*) as n from oauth_states where state_hash = 'legacy'"),
    ).toBe(1);
    expect(await countOf("select count(*) as n from users where email = 'bob@deletion.test'")).toBe(
      1,
    );
    expect(await indexDefinition('email_outbox_payload_user_id_idx')).toBeUndefined();
    expect(await indexDefinition('email_outbox_to_email_idx')).toBeUndefined();
    expect(
      await countOf(
        "select count(*) as n from pg_constraint where conname like 'oauth_states_%' and conname not in ('oauth_states_pkey', 'oauth_states_language_check')",
      ),
    ).toBe(0);

    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await oauthStateColumns()).toHaveLength(3);
  });

  it('has a `when` greater than every earlier entry (the migrator applies by `when`)', async () => {
    const entries = (await readJournal()).filter(
      (entry) =>
        entry.tag !== MOVEMENTS_TAG &&
        entry.tag !== TRANSFERS_EXCHANGES_TAG &&
        entry.tag !== TAGS_TAG &&
        entry.tag !== '0018_device_write_limit' &&
        entry.tag !== '0019_credit_cards' &&
        entry.tag !== '0020_installments' &&
        entry.tag !== INVESTMENTS_TAG &&
        entry.tag !== PRICE_SNAPSHOTS_TAG &&
        entry.tag !== '0011_account_include_in_available' &&
        entry.tag !== '0012_exchange_rates',
    );
    const others = entries.filter((entry) => entry.tag !== '0010_account_deletion');

    expect(entries.find((entry) => entry.tag === '0010_account_deletion')).toMatchObject({
      idx: 10,
    });
    expect(
      isAfterPredecessors(
        entries,
        '0010_account_deletion',
        others.map((entry) => entry.tag),
      ),
    ).toBe(true);
    const newest = entries.find((entry) => entry.tag === '0010_account_deletion');
    expect(others).toHaveLength(entries.length - 1);
    for (const entry of others) expect(newest?.when).toBeGreaterThan(entry.when);
    expect(newest?.when).toBeGreaterThan(1790902441319);
  });
});

const ROLLBACK_0011 = '0011_account_include_in_available';

/** Inserts one account of the given type without the new column (a row created before 0011). */
async function insertLegacyAccount(owner: string, name: string, type: string): Promise<void> {
  await client.query(
    `insert into accounts (owner_id, name, type, currency, opening_balance) values ('${owner}', '${name}', '${type}', 'ARS', 0)`,
  );
}

async function includeByName(owner: string): Promise<Record<string, boolean>> {
  const result = await client.query<{ name: string; include_in_available: boolean }>(
    `select name, include_in_available from accounts where owner_id = '${owner}' order by name`,
  );
  return Object.fromEntries(result.rows.map((row) => [row.name, row.include_in_available]));
}

async function includeColumn(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts' and column_name = 'include_in_available'`,
  );
  return result.rows;
}

describe('0011_account_include_in_available migration', () => {
  let owner = '';

  it('has one journal entry per migration and a `when` above the maximum of the earlier ones (validates NFR-03)', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === ROLLBACK_0011);
    expect(own?.idx).toBe(11);
    expect(entries.filter((entry) => entry.tag === ROLLBACK_0011)).toHaveLength(1);
    const earlierMax = Math.max(
      ...entries
        .filter(
          (entry) => entry.idx < 11 && entry.tag !== INVESTMENTS_TAG && entry.tag !== MOVEMENTS_TAG,
        )
        .map((entry) => entry.when),
    );
    expect(own?.when).toBeGreaterThan(earlierMax);
  });

  it('backfills accounts of every type created before it with the type default (validates AC-21, FR-11)', async () => {
    owner = await insertUser('ana@available.test');
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback(ROLLBACK_0011));
    expect(await includeColumn()).toEqual([]);
    for (const type of ACCOUNT_TYPES) await insertLegacyAccount(owner, `legacy-${type}`, type);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await includeByName(owner)).toEqual({
      'legacy-bank_account': true,
      'legacy-cash': true,
      'legacy-credit_card': false,
      'legacy-digital_wallet': true,
      'legacy-savings': false,
    });
  });

  it('gives the SQL backfill the same result as defaultIncludeInAvailable for each of the five types (validates AC-21)', async () => {
    expect(ACCOUNT_TYPES).toHaveLength(5);
    const stored = await includeByName(owner);
    for (const type of ACCOUNT_TYPES as readonly AccountType[]) {
      expect(stored[`legacy-${type}`]).toBe(defaultIncludeInAvailable(type));
    }
  });

  it('adds a NOT NULL boolean column without default and refuses an insert that omits it (error path)', async () => {
    expect(await includeColumn()).toEqual([
      {
        table_name: 'accounts',
        column_name: 'include_in_available',
        data_type: 'boolean',
        is_nullable: 'NO',
        column_default: null,
      },
    ]);
    expect(
      await sqlState(
        `insert into accounts (owner_id, name, type, currency, opening_balance) values ('${owner}', 'no-value', 'cash', 'ARS', 0)`,
      ),
    ).toBe('23502');
  });

  it('refuses a credit card marked as included on insert and on update at the database level (error path, validates AC-10, AC-11)', async () => {
    expect(
      await sqlState(
        `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${owner}', 'card-in', 'credit_card', 'ARS', 0, true)`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        `update accounts set include_in_available = true where owner_id = '${owner}' and type = 'credit_card'`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${owner}', 'card-out', 'credit_card', 'ARS', 0, false)`,
      ),
    ).toBeUndefined();
    expect(
      await countOf(
        "select count(*) as n from pg_constraint where conname = 'accounts_credit_card_not_available_check'",
      ),
    ).toBe(1);
  });

  it('keeps the value across an archive and an unarchive (validates AC-01)', async () => {
    await client.query(
      `update accounts set include_in_available = false where owner_id = '${owner}' and name = 'legacy-cash'`,
    );
    await client.query(
      `update accounts set archived_at = now() where owner_id = '${owner}' and name = 'legacy-cash'`,
    );
    expect((await includeByName(owner))['legacy-cash']).toBe(false);
    await client.query(
      `update accounts set archived_at = null where owner_id = '${owner}' and name = 'legacy-cash'`,
    );
    expect((await includeByName(owner))['legacy-cash']).toBe(false);
  });

  it('leaves no column and no changed row when the statements run in one transaction and the last one fails (error path, validates NFR-03)', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback(ROLLBACK_0011));
    expect(await includeColumn()).toEqual([]);
    const rowsBefore = await countOf('select count(*) as n from accounts');
    const statements = (await readFile(`${migrationsFolder}/${ROLLBACK_0011}.sql`, 'utf8'))
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThan(1);

    await client.query('begin');
    let failed = false;
    try {
      for (const statement of statements.slice(0, -1)) await client.query(statement);
      expect(await includeColumn()).toHaveLength(1);
      await client.query('select 1 / 0');
    } catch {
      failed = true;
    }
    await client.query('rollback');

    expect(failed).toBe(true);
    expect(await includeColumn()).toEqual([]);
    expect(await countOf('select count(*) as n from accounts')).toBe(rowsBefore);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 10);
  });

  it('is reverted by its rollback (column and journal row gone) and re-applies, restoring the type default of a non-default value (validates NFR-03)', async () => {
    await runMigrations(emptyDatabaseUrl);
    await client.query(
      `update accounts set include_in_available = false where owner_id = '${owner}' and name = 'legacy-cash'`,
    );
    await client.query(
      `update accounts set include_in_available = true where owner_id = '${owner}' and name = 'legacy-savings'`,
    );

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    await client.query(await rollback(ROLLBACK_0011));

    expect(await includeColumn()).toEqual([]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 10);
    expect(await countOf('select count(*) as n from accounts')).toBeGreaterThan(0);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    const stored = await includeByName(owner);
    expect(stored['legacy-cash']).toBe(true);
    expect(stored['legacy-savings']).toBe(false);
  });
});

describe('0012_exchange_rates migration', () => {
  it('applies on a database at 0007: the three tables with their checks, defaults and index', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));
    expect(await publicTables()).toEqual(TABLES_WITHOUT_EXCHANGE_RATES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 9);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);

    // exchange_rates: type and range checks, one row per type
    const rate = (type: string, buy: string, sell: string) =>
      sqlState(
        `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at) values ('${type}', ${buy}, ${sell}, now(), now())`,
      );
    expect(await rate('blue', '1', '100000000000')).toBeUndefined();
    expect(await rate('blue', '1', '1')).toBe('23505');
    expect(await rate('euro', '1', '1')).toBe('23514');
    expect(await rate('mep', '0', '1')).toBe('23514');
    expect(await rate('mep', '1', '0')).toBe('23514');
    expect(await rate('mep', '100000000001', '1')).toBe('23514');
    expect(await rate('mep', '1', '100000000001')).toBe('23514');

    // exchange_rate_sync: a single row (id = 1), failures default to 0 and never negative
    const sync = await client.query<{ consecutive_failures: number; last_success_at: Date | null }>(
      'insert into exchange_rate_sync (id, next_attempt_at) values (1, now()) returning consecutive_failures, last_success_at',
    );
    expect(sync.rows).toEqual([{ consecutive_failures: 0, last_success_at: null }]);
    expect(
      await sqlState('insert into exchange_rate_sync (id, next_attempt_at) values (2, now())'),
    ).toBe('23514');
    expect(
      await sqlState('insert into exchange_rate_sync (id, next_attempt_at) values (1, now())'),
    ).toBe('23505');
    expect(await sqlState('update exchange_rate_sync set consecutive_failures = -1')).toBe('23514');

    // exchange_rate_refresh_failures: generated id, code, status code and detail checks
    const failure = (code: string, status: string, detail: string) =>
      sqlState(
        `insert into exchange_rate_refresh_failures (failed_at, code, status_code, detail) values (now(), '${code}', ${status}, ${detail})`,
      );
    expect(await failure('provider_timeout', 'null', 'null')).toBeUndefined();
    expect(await failure('provider_bad_status', '599', `'${'x'.repeat(200)}'`)).toBeUndefined();
    expect(await failure('other', 'null', 'null')).toBe('23514');
    expect(await failure('provider_bad_status', '99', 'null')).toBe('23514');
    expect(await failure('provider_bad_status', '600', 'null')).toBe('23514');
    expect(await failure('provider_bad_status', 'null', `'${'x'.repeat(201)}'`)).toBe('23514');
    expect(await indexDefinition('exchange_rate_refresh_failures_failed_at_idx')).toBe(
      'CREATE INDEX exchange_rate_refresh_failures_failed_at_idx ON public.exchange_rate_refresh_failures USING btree (failed_at)',
    );
  });

  it('is reverted by its rollback (dropping the three tables, keeping the rest), and re-applies', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    await client.query(await rollback('0013_investments'));
    await client.query(await rollback('0012_exchange_rates'));

    expect(await publicTables()).toEqual(TABLES_WITHOUT_EXCHANGE_RATES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 9);
    expect(await indexDefinition('exchange_rate_refresh_failures_failed_at_idx')).toBeUndefined();

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });

  it('has the 0012 entry after every migration it builds on: its `when` is greater than that of each earlier entry', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === '0012_exchange_rates');

    expect(own?.idx).toBe(12);
    expect(entries.filter((entry) => entry.tag === '0012_exchange_rates')).toHaveLength(1);
    for (const entry of entries.filter(
      (candidate) =>
        candidate.idx < 12 && candidate.tag !== INVESTMENTS_TAG && candidate.tag !== MOVEMENTS_TAG,
    )) {
      expect(own?.when ?? 0).toBeGreaterThan(entry.when);
    }
  });
});

describe('0013_investments migration journal order', () => {
  it('has one entry whose `when` is greater than that of every migration it was rebased onto', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === INVESTMENTS_TAG);
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
    ];

    expect(own?.idx).toBe(13);
    expect(entries.filter((entry) => entry.tag === INVESTMENTS_TAG)).toHaveLength(1);
    for (const tag of predecessors) {
      expect(
        entries.map((entry) => entry.tag),
        tag,
      ).toContain(tag);
    }
    expect(isAfterPredecessors(entries, INVESTMENTS_TAG, predecessors)).toBe(true);
  });
});

async function accountsOwnerUniqueCount(): Promise<number> {
  return countOf(
    "select count(*) as n from pg_constraint where conname = 'accounts_id_owner_unique' and contype = 'u'",
  );
}

describe('0014_movements migration', () => {
  let owner = '';
  let otherOwner = '';
  let account = '';
  let otherAccount = '';
  let expenseCategory = '';
  let incomeCategory = '';

  async function insertAccount(ownerId: string, name: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${ownerId}', '${name}', 'cash', 'ARS', 0, true) returning id`,
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertCategory(ownerId: string, kind: string, name: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      `insert into categories (owner_id, kind, name, icon, color) values ('${ownerId}', '${kind}', '${name}', 'tag', 'blue') returning id`,
    );
    return result.rows[0]?.id ?? '';
  }

  function insertMovement(overrides: Record<string, string> = {}): Promise<string | undefined> {
    const row: Record<string, string> = {
      owner_id: `'${owner}'`,
      type: "'expense'",
      account_id: `'${account}'`,
      category_id: `'${expenseCategory}'`,
      amount: '100',
      occurred_at: "'2026-10-02T15:30:00Z'",
      rate: '16233000',
      rate_source: "'manual'",
      ...overrides,
    };
    return sqlState(
      `insert into movements (${Object.keys(row).join(', ')}) values (${Object.values(row).join(', ')})`,
    );
  }

  it('applies on the previous migrations, with existing accounts and categories untouched', async () => {
    owner = await insertUser('ana@movements.test');
    otherOwner = await insertUser('beto@movements.test');
    account = await insertAccount(owner, 'Caja movements');
    otherAccount = await insertAccount(otherOwner, 'Caja otro');
    expenseCategory = await insertCategory(owner, 'expense', 'Gasto movements');
    incomeCategory = await insertCategory(owner, 'income', 'Ingreso movements');
    const accountsBefore = await countOf('select count(*) as n from accounts');

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    expect(await publicTables()).toEqual(
      ALL_TABLES.filter(
        (name) =>
          !MOVEMENT_TABLES.includes(name) &&
          !PRICE_TABLES.includes(name) &&
          !TAG_TABLES.includes(name) &&
          !CREDIT_CARD_TABLES.includes(name),
      ),
    );
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 7);
    expect(await accountsOwnerUniqueCount()).toBe(0);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await accountsOwnerUniqueCount()).toBe(1);
    expect(await countOf('select count(*) as n from accounts')).toBe(accountsBefore);
  });

  it('enforces the checks, the composite keys and the restrict rules', async () => {
    expect(await insertMovement()).toBeUndefined();
    expect(
      await insertMovement({
        type: "'income'",
        category_id: `'${incomeCategory}'`,
        rate_source: "'automatic'",
        rate_type: "'blue'",
      }),
    ).toBeUndefined();

    // checks
    expect(await insertMovement({ amount: '0' })).toBe('23514');
    expect(await insertMovement({ amount: '1000000000000001' })).toBe('23514');
    expect(await insertMovement({ rate: '0' })).toBe('23514');
    expect(await insertMovement({ rate: '100000000001' })).toBe('23514');
    expect(await insertMovement({ type: "'transfer'" })).toBe('23514');
    expect(await insertMovement({ occurred_at: "'1969-12-31T23:59:59Z'" })).toBe('23514');
    expect(await insertMovement({ note: `'${'x'.repeat(501)}'` })).toBe('23514');
    expect(await insertMovement({ rate_source: "'automatic'" })).toBe('23514');
    expect(await insertMovement({ rate_type: "'blue'" })).toBe('23514');

    // composite keys
    expect(await insertMovement({ account_id: `'${otherAccount}'` })).toBe('23503');
    expect(await insertMovement({ category_id: `'${incomeCategory}'` })).toBe('23503');

    // restrict, and the limiter relation
    expect(await sqlState(`delete from accounts where id = '${account}'`)).toBe('23503');
    expect(await sqlState(`delete from categories where id = '${expenseCategory}'`)).toBe('23503');
    expect(
      await sqlState(
        `insert into movement_rate_limits (owner_id, window_start, count) values ('${owner}', now(), -1)`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        `insert into movement_rate_limits (owner_id, window_start, count) values ('${owner}', '2026-10-02T15:30:00Z', 1)`,
      ),
    ).toBeUndefined();
    expect(
      await sqlState(
        `insert into movement_rate_limits (owner_id, window_start, count) values ('${owner}', '2026-10-02T15:30:00Z', 2)`,
      ),
    ).toBe('23505');
  });

  it('is reverted by its rollback with accounts intact, which can run twice, and re-applies', async () => {
    const accountsBefore = await countOf('select count(*) as n from accounts');
    expect(accountsBefore).toBeGreaterThan(0);

    // 0016 and 0015 are newer than 0014, so they go first; the migrator only replays what is newer than the last recorded.
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));

    expect(await publicTables()).toEqual(
      ALL_TABLES.filter(
        (name) =>
          !MOVEMENT_TABLES.includes(name) &&
          !PRICE_TABLES.includes(name) &&
          !TAG_TABLES.includes(name) &&
          !CREDIT_CARD_TABLES.includes(name),
      ),
    );
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 7);
    expect(await accountsOwnerUniqueCount()).toBe(0);
    expect(await countOf('select count(*) as n from accounts')).toBe(accountsBefore);

    // Idempotent: a second run changes nothing and raises nothing.
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 7);
    expect(await countOf('select count(*) as n from accounts')).toBe(accountsBefore);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await accountsOwnerUniqueCount()).toBe(1);
  });

  it('has a rollback that still runs when accounts is already gone', async () => {
    // The rollbacks of older migrations drop accounts; the script of 0014 must still run then.
    await client.query('drop table movement_tags, movement_rate_limits, movements');
    await client.query('drop table accounts cascade');
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0016_transfers_exchanges'));
    await client.query(await rollback('0015_price_snapshots'));
    await client.query(await rollback('0014_movements'));
    // Restore the full schema for whatever runs next.
    await emptyTheDatabase(client);
    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
  });

  it('has one journal entry at idx 14 whose `when` is greater than that of every earlier entry', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === MOVEMENTS_TAG);

    expect(own?.idx).toBe(14);
    expect(entries.filter((entry) => entry.tag === MOVEMENTS_TAG)).toHaveLength(1);
    const earlier = entries.filter((entry) => entry.idx < 14);
    expect(earlier.map((entry) => entry.tag)).toContain(INVESTMENTS_TAG);
    for (const entry of earlier) expect(own?.when ?? 0).toBeGreaterThan(entry.when);
    // 0012 and the 0013 of DISC-001-07a are known predecessors; nothing here says 0014 is the newest.
    expect(own?.when ?? 0).toBeGreaterThan(1790945403578);
    expect(
      isAfterPredecessors(
        entries,
        MOVEMENTS_TAG,
        earlier.map((entry) => entry.tag),
      ),
    ).toBe(true);
  });
});

/** The `when` of DISC-001-07b's price snapshots, the greatest seen on any worktree when 0016 was written. */
const GREATEST_WHEN_AT_0016_WRITING = 1790980568164;

describe('0016_transfers_exchanges migration', () => {
  let owner = '';
  let arsAccount = '';
  let arsAccount2 = '';
  let usdAccount = '';
  let expenseCategory = '';

  async function insertAccount(name: string, currency: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${owner}', '${name}', 'cash', '${currency}', 0, true) returning id`,
    );
    return result.rows[0]?.id ?? '';
  }

  function insertRow(row: Record<string, string>): Promise<string | undefined> {
    const full: Record<string, string> = {
      owner_id: `'${owner}'`,
      occurred_at: "'2026-10-02T15:30:00Z'",
      ...row,
    };
    return sqlState(
      `insert into movements (${Object.keys(full).join(', ')}) values (${Object.values(full).join(', ')})`,
    );
  }

  const expenseRow = () => ({
    type: "'expense'",
    account_id: `'${arsAccount}'`,
    category_id: `'${expenseCategory}'`,
    amount: '100',
    rate: '16233000',
    rate_source: "'manual'",
  });
  const transferRow = () => ({
    type: "'transfer'",
    account_id: `'${arsAccount}'`,
    destination_account_id: `'${arsAccount2}'`,
    amount: '50',
    destination_amount: '50',
  });
  const exchangeRow = () => ({
    type: "'exchange'",
    account_id: `'${arsAccount}'`,
    destination_account_id: `'${usdAccount}'`,
    amount: '1500000',
    destination_amount: '1000',
    rate: '15000000',
    rate_source: "'implied'",
  });

  async function columnIsNullable(column: string): Promise<boolean> {
    const result = await client.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'movements' and column_name = '${column}'`,
    );
    return result.rows[0]?.is_nullable === 'YES';
  }

  async function movementColumns(): Promise<string[]> {
    const result = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'movements'`,
    );
    return result.rows.map((row) => row.column_name);
  }

  it('applies on 0015 and keeps the existing expense and income rows untouched', async () => {
    owner = await insertUser('ana@transfers.test');
    arsAccount = await insertAccount('Caja ARS', 'ARS');
    arsAccount2 = await insertAccount('Caja ARS 2', 'ARS');
    usdAccount = await insertAccount('Caja USD', 'USD');
    const category = await client.query<{ id: string }>(
      `insert into categories (owner_id, kind, name, icon, color) values ('${owner}', 'expense', 'Gasto t', 'tag', 'blue') returning id`,
    );
    expenseCategory = category.rows[0]?.id ?? '';

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback(TRANSFERS_EXCHANGES_TAG));
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 5);
    expect(await columnIsNullable('rate')).toBe(false);
    expect(await insertRow(expenseRow())).toBeUndefined();
    expect(await insertRow({ ...expenseRow(), amount: '7' })).toBeUndefined();
    const before = await client.query(
      'select id, type, category_id, amount, rate, rate_source, rate_type from movements order by id',
    );

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    const after = await client.query(
      'select id, type, category_id, amount, rate, rate_source, rate_type from movements order by id',
    );
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(2);
  });

  it('accepts the three shapes and refuses malformed rows, with the destination key restricting deletes', async () => {
    expect(await insertRow(transferRow())).toBeUndefined();
    expect(await insertRow(exchangeRow())).toBeUndefined();
    expect(await insertRow({ ...transferRow(), destination_amount: '49' })).toBe('23514');
    expect(await insertRow({ ...transferRow(), rate: '1' })).toBe('23514');
    expect(await insertRow({ ...exchangeRow(), rate_source: "'manual'" })).toBe('23514');
    expect(await insertRow({ ...exchangeRow(), destination_amount: '0' })).toBe('23514');
    expect(await insertRow({ ...transferRow(), destination_account_id: `'${arsAccount}'` })).toBe(
      '23514',
    );
    expect(await insertRow({ ...transferRow(), type: "'refund'" })).toBe('23514');
    expect(await sqlState(`delete from accounts where id = '${usdAccount}'`)).toBe('23503');
  });

  it('is reverted by its rollback, which deletes only transfers and exchanges, runs twice and re-applies', async () => {
    const expensesBefore = await countOf(
      "select count(*) as n from movements where type in ('expense', 'income')",
    );
    expect(expensesBefore).toBe(2);
    expect(
      await countOf("select count(*) as n from movements where type in ('transfer', 'exchange')"),
    ).toBe(2);

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    await client.query(await rollback(TRANSFERS_EXCHANGES_TAG));

    expect(await countOf('select count(*) as n from movements')).toBe(expensesBefore);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 5);
    expect(await columnIsNullable('category_id')).toBe(false);
    expect(await columnIsNullable('rate')).toBe(false);
    expect(await columnIsNullable('rate_source')).toBe(false);
    const columns = await movementColumns();
    expect(columns).not.toContain('destination_account_id');
    expect(columns).not.toContain('destination_amount');
    // The original checks are back: a transfer no longer fits the type list.
    expect(
      await insertRow({
        type: "'transfer'",
        account_id: `'${arsAccount}'`,
        category_id: `'${expenseCategory}'`,
        amount: '5',
        rate: '1',
        rate_source: "'manual'",
      }),
    ).toBe('23514');
    expect(await insertRow({ ...expenseRow(), rate_source: "'implied'" })).toBe('23514');
    expect(await insertRow({ ...expenseRow(), rate: 'null' })).toBe('23502');

    // Idempotent.
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback(TRANSFERS_EXCHANGES_TAG));
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 5);
    expect(await countOf('select count(*) as n from movements')).toBe(expensesBefore);

    await runMigrations(emptyDatabaseUrl);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await columnIsNullable('category_id')).toBe(true);
  });

  it('has a rollback that still runs when movements is already gone', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback(TRANSFERS_EXCHANGES_TAG));
    await client.query(await rollback(MOVEMENTS_TAG));
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback(TRANSFERS_EXCHANGES_TAG));
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback(TRANSFERS_EXCHANGES_TAG));
    await emptyTheDatabase(client);
    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
  });

  it('has one journal entry at idx 16 whose `when` is greater than 0015 and than every earlier entry', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === TRANSFERS_EXCHANGES_TAG);

    expect(own?.idx).toBe(16);
    expect(entries.filter((entry) => entry.tag === TRANSFERS_EXCHANGES_TAG)).toHaveLength(1);
    expect(own?.when ?? 0).toBeGreaterThan(GREATEST_WHEN_AT_0016_WRITING);
    const earlier = entries.filter((entry) => entry.idx < 16);
    expect(earlier.map((entry) => entry.tag)).toContain(PRICE_SNAPSHOTS_TAG);
    for (const entry of earlier) expect(own?.when ?? 0).toBeGreaterThan(entry.when);
  });

  it('chains its snapshot onto the snapshot of 0015', async () => {
    const read = async (name: string) =>
      JSON.parse(await readFile(`${migrationsFolder}/meta/${name}`, 'utf8')) as {
        id: string;
        prevId: string;
      };
    const previous = await read('0015_snapshot.json');
    const own = await read('0016_snapshot.json');
    expect(previous.id).toBe('33671041-d300-4169-bbd7-0c5afe483f9c');
    expect(own.prevId).toBe(previous.id);
  });
});

describe('0017_tags migration', () => {
  let owner = '';
  let otherOwner = '';
  let movement = '';
  let otherMovement = '';
  let ownerTag = '';
  let otherTag = '';

  async function insertReturningId(statement: string): Promise<string> {
    const result = await client.query<{ id: string }>(statement);
    return result.rows[0]?.id ?? '';
  }

  async function insertMovementOf(ownerId: string, label: string): Promise<string> {
    const account = await insertReturningId(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ('${ownerId}', 'Caja ${label}', 'cash', 'ARS', 0, true) returning id`,
    );
    const category = await insertReturningId(
      `insert into categories (owner_id, kind, name, icon, color) values ('${ownerId}', 'expense', 'Gasto ${label}', 'tag', 'blue') returning id`,
    );
    return insertReturningId(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source) values ('${ownerId}', 'expense', '${account}', '${category}', 100, '2026-10-02T15:30:00Z', 16233000, 'manual') returning id`,
    );
  }

  const insertTag = (ownerId: string, name: string): Promise<string | undefined> =>
    sqlState(`insert into tags (owner_id, name) values ('${ownerId}', '${name}')`);

  const link = (movementId: string, tagId: string, ownerId: string, position: number) =>
    sqlState(
      `insert into movement_tags (movement_id, tag_id, owner_id, position) values ('${movementId}', '${tagId}', '${ownerId}', ${position})`,
    );

  it('applies on a database with 0014 and existing movements, which stay untouched', async () => {
    owner = await insertUser('ana@tags.test');
    otherOwner = await insertUser('beto@tags.test');
    movement = await insertMovementOf(owner, 'ana');
    otherMovement = await insertMovementOf(otherOwner, 'beto');
    const before = await client.query('select * from movements order by id');

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    expect(await publicTables()).toEqual(
      ALL_TABLES.filter((name) => !TAG_TABLES.includes(name) && !CREDIT_CARD_TABLES.includes(name)),
    );
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 4);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect((await client.query('select * from movements order by id')).rows).toEqual(before.rows);
  });

  it('enforces the name checks, the case-insensitive unique name and the link keys and caps', async () => {
    expect(await insertTag(owner, 'Trip')).toBeUndefined();
    ownerTag = await insertReturningId(
      `select id from tags where owner_id = '${owner}' and name = 'Trip'`,
    );
    expect(await insertTag(owner, 'trip')).toBe('23505');
    expect(await insertTag(otherOwner, 'trip')).toBeUndefined();
    otherTag = await insertReturningId(`select id from tags where owner_id = '${otherOwner}'`);
    expect(await insertTag(owner, '')).toBe('23514');
    expect(await insertTag(owner, 'x'.repeat(31))).toBe('23514');
    expect(await insertTag(owner, 'x'.repeat(30))).toBeUndefined();

    expect(await link(movement, ownerTag, owner, 0)).toBeUndefined();
    expect(await link(movement, ownerTag, owner, 1)).toBe('23505');
    expect(await link(movement, otherTag, owner, 1)).toBe('23503');
    expect(await link(otherMovement, ownerTag, otherOwner, 0)).toBe('23503');
    expect(await link(otherMovement, otherTag, owner, 0)).toBe('23503');
    expect(await link(otherMovement, otherTag, otherOwner, 10)).toBe('23514');
    expect(await link(otherMovement, otherTag, otherOwner, -1)).toBe('23514');
  });

  it('cascades from the movement, the tag and the user, and leaves the other owner alone', async () => {
    expect(await countOf('select count(*) as n from movement_tags')).toBe(1);
    expect(await sqlState(`delete from movements where id = '${movement}'`)).toBeUndefined();
    expect(await countOf('select count(*) as n from movement_tags')).toBe(0);
    expect(await link(otherMovement, otherTag, otherOwner, 0)).toBeUndefined();
    expect(await sqlState(`delete from tags where id = '${otherTag}'`)).toBeUndefined();
    expect(await countOf('select count(*) as n from movement_tags')).toBe(0);
    expect(await sqlState(`delete from users where id = '${owner}'`)).toBeUndefined();
    expect(await countOf(`select count(*) as n from tags where owner_id = '${owner}'`)).toBe(0);
  });

  it('is reverted by its rollback with movements intact, which can run twice, and re-applies', async () => {
    const movementsBefore = await countOf('select count(*) as n from movements');
    expect(movementsBefore).toBeGreaterThan(0);

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));

    expect(await publicTables()).toEqual(
      ALL_TABLES.filter((name) => !TAG_TABLES.includes(name) && !CREDIT_CARD_TABLES.includes(name)),
    );
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 4);
    expect(
      await countOf(
        "select count(*) as n from pg_constraint where conname = 'movements_id_owner_unique'",
      ),
    ).toBe(0);
    expect(
      await countOf(
        "select count(*) as n from pg_indexes where indexname in ('movements_owner_account_date_idx', 'movements_owner_category_date_idx')",
      ),
    ).toBe(0);
    expect(await countOf('select count(*) as n from movements')).toBe(movementsBefore);

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));

    await client.query(await rollback('0017_tags'));
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 4);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });

  it('has a rollback that still runs when movements is already gone', async () => {
    await client.query('drop table movement_tags, tags');
    await client.query('drop table movement_rate_limits, movements cascade');
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback('0018_device_write_limit'));
    await client.query(await rollback('0017_tags'));
    await emptyTheDatabase(client);
    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
  });

  it('has one journal entry at idx 17 tagged 0017_tags whose `when` is greater than every earlier entry', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === TAGS_TAG);

    expect(own?.idx).toBe(17);
    expect(entries.filter((entry) => entry.tag === TAGS_TAG)).toHaveLength(1);
    const earlier = entries.filter((entry) => entry.idx < 17);
    expect(earlier.map((entry) => entry.tag)).toContain(MOVEMENTS_TAG);
    for (const entry of earlier) expect(own?.when ?? 0).toBeGreaterThan(entry.when);
    expect(own?.when ?? 0).toBeGreaterThan(1790966184307);
    expect(
      isAfterPredecessors(
        entries,
        TAGS_TAG,
        earlier.map((entry) => entry.tag),
      ),
    ).toBe(true);
  });
});

describe('0018_device_write_limit migration', () => {
  const DEVICE_LIMIT_TAG = '0018_device_write_limit';
  let owner = '';
  const WINDOW = '2026-10-02T15:30:00Z';

  const bucketsOf = async (ownerId: string): Promise<Map<string, number>> => {
    const result = await client.query<{ bucket: string; count: number }>(
      `select bucket, count from movement_rate_limits where owner_id = '${ownerId}' order by bucket`,
    );
    return new Map(result.rows.map((row) => [row.bucket, row.count]));
  };

  const primaryKeyColumns = async (): Promise<string[]> => {
    const result = await client.query<{ columns: string[] }>(
      `select array_agg(a.attname::text order by k.ord) as columns
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         cross join lateral unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.contype = 'p' and t.relname = 'movement_rate_limits'`,
    );
    return result.rows[0]?.columns ?? [];
  };

  const hasBucketColumn = async (): Promise<boolean> =>
    (await countOf(
      "select count(*) as n from information_schema.columns where table_name = 'movement_rate_limits' and column_name = 'bucket'",
    )) === 1;

  it('applies on a database with 0017 and existing counters, which keep their count and read as manual', async () => {
    owner = await insertUser('ana@device-limit.test');
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback(DEVICE_LIMIT_TAG));
    await client.query(
      `insert into movement_rate_limits (owner_id, window_start, count) values ('${owner}', '${WINDOW}', 7)`,
    );
    expect(await hasBucketColumn()).toBe(false);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 3);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await hasBucketColumn()).toBe(true);
    expect(await bucketsOf(owner)).toEqual(new Map([['manual', 7]]));
  });

  it('keys the counter by owner, bucket and window, and refuses an invalid bucket', async () => {
    expect(await primaryKeyColumns()).toEqual(['owner_id', 'bucket', 'window_start']);
    expect(
      await sqlState(
        `insert into movement_rate_limits (owner_id, bucket, window_start, count) values ('${owner}', 'device', '${WINDOW}', 1)`,
      ),
    ).toBeUndefined();
    expect(
      await sqlState(
        `insert into movement_rate_limits (owner_id, bucket, window_start, count) values ('${owner}', 'device', '${WINDOW}', 2)`,
      ),
    ).toBe('23505');
    expect(
      await sqlState(
        `insert into movement_rate_limits (owner_id, bucket, window_start, count) values ('${owner}', 'bulk', '${WINDOW}', 1)`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        `insert into movement_rate_limits (owner_id, bucket, window_start, count) values ('${owner}', null, '${WINDOW}', 1)`,
      ),
    ).toBe('23502');
    expect(await bucketsOf(owner)).toEqual(
      new Map([
        ['device', 1],
        ['manual', 7],
      ]),
    );
  });

  it('is reverted by its rollback with the manual counters intact, which can run twice, and re-applies', async () => {
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback(DEVICE_LIMIT_TAG));

    expect(await hasBucketColumn()).toBe(false);
    expect(await primaryKeyColumns()).toEqual(['owner_id', 'window_start']);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 3);
    expect(
      await countOf(
        `select count(*) as n from movement_rate_limits where owner_id = '${owner}' and count = 7`,
      ),
    ).toBe(1);
    expect(
      await countOf(`select count(*) as n from movement_rate_limits where owner_id = '${owner}'`),
    ).toBe(1);

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback(DEVICE_LIMIT_TAG));
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 3);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await primaryKeyColumns()).toEqual(['owner_id', 'bucket', 'window_start']);
    expect(await publicTables()).toEqual(ALL_TABLES);
  });

  it('has a rollback that still runs when movement_rate_limits is already gone', async () => {
    await client.query('drop table movement_tags, tags');
    await client.query('drop table movement_rate_limits, movements cascade');
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback(DEVICE_LIMIT_TAG));
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback('0019_credit_cards'));
    await client.query(await rollback(DEVICE_LIMIT_TAG));
    await emptyTheDatabase(client);
    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(ALL_TABLES);
  });

  it('has one journal entry at idx 18 whose `when` is greater than every earlier entry', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === DEVICE_LIMIT_TAG);

    expect(own?.idx).toBe(18);
    expect(entries.filter((entry) => entry.tag === DEVICE_LIMIT_TAG)).toHaveLength(1);
    const earlier = entries.filter((entry) => entry.idx < 18);
    expect(earlier.map((entry) => entry.tag)).toContain(TAGS_TAG);
    for (const entry of earlier) expect(own?.when ?? 0).toBeGreaterThan(entry.when);
    expect(own?.when ?? 0).toBeGreaterThan(1790992572883);
  });

  it('chains its snapshot onto the snapshot of 0017', async () => {
    const read = async (name: string) =>
      JSON.parse(await readFile(`${migrationsFolder}/meta/${name}`, 'utf8')) as {
        id: string;
        prevId: string;
      };
    const previous = await read('0017_snapshot.json');
    const own = await read('0018_snapshot.json');
    expect(own.prevId).toBe(previous.id);
  });
});

describe('0019_credit_cards migration', () => {
  const CREDIT_CARDS_TAG = '0019_credit_cards';
  const CARD_TABLES = ['credit_card_statements', 'credit_cards'];

  const insertAccount = async (
    ownerId: string,
    name: string,
    currency: string,
  ): Promise<string> => {
    const inserted = await client.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       values ('${ownerId}', '${name}', 'credit_card', '${currency}', 0, false) returning id`,
    );
    return inserted.rows[0]?.id ?? '';
  };

  it('applies on the 0018 schema, keeps existing accounts and creates both tables (FR-02)', async () => {
    const owner = await insertUser('ana@credit-cards.test');
    await insertAccount(owner, 'Existing card', 'ARS');
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback(CREDIT_CARDS_TAG));
    expect((await publicTables()).filter((table) => CARD_TABLES.includes(table))).toEqual([]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 2);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(await countOf(`select count(*) as n from accounts where owner_id = '${owner}'`)).toBe(1);
  });

  it('links accounts of the same owner only and refuses invalid days, periods and dates (invalid input)', async () => {
    const ana = await insertUser('ana@credit-card-keys.test');
    const bea = await insertUser('bea@credit-card-keys.test');
    const ars = await insertAccount(ana, 'Visa ARS', 'ARS');
    const usd = await insertAccount(ana, 'Visa USD', 'USD');
    const beaUsd = await insertAccount(bea, 'Bea USD', 'USD');

    expect(
      await sqlState(
        `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
         values ('${ana}', 'Visa', 24, 5, '${ars}', '${beaUsd}')`,
      ),
    ).toBe('23503');
    expect(
      await sqlState(
        `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
         values ('${ana}', 'Visa', 32, 5, '${ars}', '${usd}')`,
      ),
    ).toBe('23514');
    const card = await client.query<{ id: string }>(
      `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
       values ('${ana}', 'Visa', 24, 5, '${ars}', '${usd}') returning id`,
    );
    const cardId = card.rows[0]?.id ?? '';
    const statement = (period: string, closing: string, due: string) =>
      sqlState(
        `insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date)
         values ('${cardId}', '${ana}', '${period}', '${closing}', '${due}')`,
      );

    expect(await statement('2026-10', '2026-10-24', '2026-11-05')).toBeUndefined();
    expect(await statement('2026-10', '2026-10-25', '2026-11-05')).toBe('23505');
    expect(await statement('2026-13', '2026-12-24', '2027-01-05')).toBe('23514');
    expect(await statement('2026-11', '2026-11-24', '2026-11-24')).toBe('23514');
    expect(
      await sqlState(
        `insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date)
         values ('${cardId}', '${bea}', '2026-12', '2026-12-24', '2027-01-05')`,
      ),
    ).toBe('23503');
    // Sad path: a linked account cannot be deleted while its card exists.
    expect(await sqlState(`delete from accounts where id = '${usd}'`)).toBe('23503');
  });

  it('rolls back destructively for card data only, keeps the accounts, and can run twice', async () => {
    const owner = await insertUser('ana@credit-card-rollback.test');
    const ars = await insertAccount(owner, 'Master ARS', 'ARS');
    const usd = await insertAccount(owner, 'Master USD', 'USD');
    await client.query(
      `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
       values ('${owner}', 'Master', 10, 20, '${ars}', '${usd}')`,
    );

    await client.query(await rollback('0020_installments'));

    await client.query(await rollback(CREDIT_CARDS_TAG));
    // Sad path: the second run finds nothing to drop and still succeeds.
    await client.query(await rollback('0020_installments'));
    await client.query(await rollback(CREDIT_CARDS_TAG));

    expect((await publicTables()).filter((table) => CARD_TABLES.includes(table))).toEqual([]);
    expect(await countOf(`select count(*) as n from accounts where owner_id = '${owner}'`)).toBe(2);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 2);
    await runMigrations(emptyDatabaseUrl);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });

  it('has one journal entry at idx 19 whose `when` is greater than every earlier entry and main', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === CREDIT_CARDS_TAG);

    expect(own?.idx).toBe(19);
    expect(entries.filter((entry) => entry.tag === CREDIT_CARDS_TAG)).toHaveLength(1);
    for (const entry of entries.filter((candidate) => candidate.idx < 19)) {
      expect(own?.when ?? 0).toBeGreaterThan(entry.when);
    }
    expect(own?.when ?? 0).toBeGreaterThan(1791162359112);
  });

  it('chains its snapshot onto the snapshot of 0018', async () => {
    const read = async (name: string) =>
      JSON.parse(await readFile(`${migrationsFolder}/meta/${name}`, 'utf8')) as {
        id: string;
        prevId: string;
      };
    const previous = await read('0018_snapshot.json');
    const own = await read('0019_snapshot.json');
    expect(own.prevId).toBe(previous.id);
  });
});

describe('0020_installments migration', () => {
  const INSTALLMENTS_TAG = '0020_installments';
  const INSTALLMENT_TABLES = ['installment_purchases', 'installments'];

  const insertCard = async (ownerId: string): Promise<{ cardId: string; categoryId: string }> => {
    const account = async (name: string, currency: string) =>
      (
        await client.query<{ id: string }>(
          `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
           values ('${ownerId}', '${name}', 'credit_card', '${currency}', 0, false) returning id`,
        )
      ).rows[0]?.id ?? '';
    const ars = await account('Visa ARS', 'ARS');
    const usd = await account('Visa USD', 'USD');
    const card = await client.query<{ id: string }>(
      `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
       values ('${ownerId}', 'Visa', 24, 5, '${ars}', '${usd}') returning id`,
    );
    const category = await client.query<{ id: string }>(
      `insert into categories (owner_id, kind, name, icon, color) values ('${ownerId}', 'expense', 'Compras', 'wallet', 'blue') returning id`,
    );
    return { cardId: card.rows[0]?.id ?? '', categoryId: category.rows[0]?.id ?? '' };
  };

  it('applies on the 0019 schema, creating both tables and keeping the cards (FR-01)', async () => {
    const owner = await insertUser('ana@installments-apply.test');
    await insertCard(owner);
    await client.query(await rollback(INSTALLMENTS_TAG));
    expect((await publicTables()).filter((table) => INSTALLMENT_TABLES.includes(table))).toEqual(
      [],
    );
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 1);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(ALL_TABLES);
    expect(
      await countOf(`select count(*) as n from credit_cards where owner_id = '${owner}'`),
    ).toBe(1);
  });

  it('refuses invalid counts, amounts, categories of another kind and foreign cards (invalid input)', async () => {
    const ana = await insertUser('ana@installments-keys.test');
    const bea = await insertUser('bea@installments-keys.test');
    const { cardId, categoryId } = await insertCard(ana);
    const income = (
      await client.query<{ id: string }>(
        `insert into categories (owner_id, kind, name, icon, color) values ('${ana}', 'income', 'Sueldo', 'wallet', 'blue') returning id`,
      )
    ).rows[0]?.id;
    const purchase = (owner: string, category: string, total: number, count: number) =>
      sqlState(
        `insert into installment_purchases (owner_id, card_id, category_id, total_amount, installment_count, purchased_on)
         values ('${owner}', '${cardId}', '${category}', ${total}, ${count}, '2026-10-07')`,
      );

    expect(await purchase(ana, categoryId, 120000, 12)).toBeUndefined();
    expect(await purchase(ana, categoryId, 120000, 1)).toBe('23514');
    expect(await purchase(ana, categoryId, 120000, 61)).toBe('23514');
    expect(await purchase(ana, categoryId, 0, 2)).toBe('23514');
    expect(await purchase(ana, categoryId, 5, 12)).toBe('23514');
    expect(await purchase(ana, income ?? '', 120000, 12)).toBe('23503');
    expect(await purchase(bea, categoryId, 120000, 12)).toBe('23503');
    const id = (await client.query<{ id: string }>('select id from installment_purchases')).rows[0]
      ?.id;
    const installment = (number: number, period: string, amount: number) =>
      sqlState(
        `insert into installments (purchase_id, owner_id, number, period, amount) values ('${id}', '${ana}', ${number}, '${period}', ${amount})`,
      );
    expect(await installment(1, '2026-10', 10000)).toBeUndefined();
    expect(await installment(1, '2026-11', 10000)).toBe('23505');
    expect(await installment(2, '2026-13', 10000)).toBe('23514');
    expect(await installment(0, '2026-11', 10000)).toBe('23514');
    expect(await installment(2, '2026-11', 0)).toBe('23514');
    // Sad path: a card with purchases cannot be deleted.
    expect(await sqlState(`delete from credit_cards where id = '${cardId}'`)).toBe('23503');
  });

  it('rolls back destructively for installment data only, keeps the cards, and can run twice', async () => {
    const owner = await insertUser('ana@installments-rollback.test');
    await insertCard(owner);

    await client.query(await rollback(INSTALLMENTS_TAG));
    // Sad path: the second run finds nothing to drop and still succeeds.
    await client.query(await rollback(INSTALLMENTS_TAG));

    expect((await publicTables()).filter((table) => INSTALLMENT_TABLES.includes(table))).toEqual(
      [],
    );
    expect(
      await countOf(`select count(*) as n from credit_cards where owner_id = '${owner}'`),
    ).toBe(1);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 1);
    await runMigrations(emptyDatabaseUrl);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });

  it('has one journal entry at idx 20 whose `when` is greater than every earlier entry and main', async () => {
    const entries = await readJournal();
    const own = entries.find((entry) => entry.tag === INSTALLMENTS_TAG);

    expect(own?.idx).toBe(20);
    expect(entries.filter((entry) => entry.tag === INSTALLMENTS_TAG)).toHaveLength(1);
    for (const entry of entries.filter((candidate) => candidate.idx < 20)) {
      expect(own?.when ?? 0).toBeGreaterThan(entry.when);
    }
    expect(own?.when ?? 0).toBeGreaterThan(1791246865297);
  });

  it('chains its snapshot onto the snapshot of 0019', async () => {
    const read = async (name: string) =>
      JSON.parse(await readFile(`${migrationsFolder}/meta/${name}`, 'utf8')) as {
        id: string;
        prevId: string;
      };
    const previous = await read('0019_snapshot.json');
    const own = await read('0020_snapshot.json');
    expect(own.prevId).toBe(previous.id);
  });
});
