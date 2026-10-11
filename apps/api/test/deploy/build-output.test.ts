import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const distDir = path.join(apiRoot, 'dist');
const entryPoints = ['server.js', 'worker.js', path.join('shared', 'db', 'migrate.js')];
const builtMigration = path.join(distDir, 'shared', 'db', 'migrate.js');

/** Set while building; the bundle must never carry it, because nothing inlines environment values. */
const BUILD_CANARY = 'build-canary-4f1c9e27d8';

const ALL_TABLES = [
  'accounts',
  'auth_attempts',
  'card_statement_import_lines',
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
  'group_activity_log',
  'group_categories',
  'group_claim_links',
  'group_default_split_shares',
  'group_expense_shares',
  'group_expenses',
  'group_invitations',
  'group_members',
  'group_settlement_legs',
  'group_settlements',
  'groups',
  'holdings',
  'installment_purchases',
  'installments',
  'movement_rate_limits',
  'movement_tags',
  'movements',
  'notices',
  'oauth_states',
  'one_time_tokens',
  'portfolio_value_snapshots',
  'portfolios',
  'recovery_codes',
  'recurring_occurrences',
  'recurring_payments',
  'sessions',
  'sign_in_challenges',
  'tags',
  'user_identities',
  'user_two_factor',
  'users',
];

/** A throwaway database, so the built migration runs on a truly empty one. */
const emptyDatabaseUrl = (() => {
  const url = new URL(testDatabaseUrl);
  // Derived from the test database name so parallel worktrees on one server do not share it.
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_build_test`;
  return url.toString();
})();

const BUILD_TIMEOUT_MS = 60_000;

function withoutDatabaseUrl(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.DATABASE_URL;
  return env;
}

function runNode(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, args, { cwd: apiRoot, env, encoding: 'utf8' });
}

async function emptyTheDatabase(client: pg.Client): Promise<void> {
  await client.query('drop schema if exists drizzle cascade');
  await client.query('drop schema if exists public cascade');
  await client.query('create schema public');
}

let client: pg.Client | undefined;

beforeAll(async () => {
  const build = runNode(['scripts/build.mjs'], withoutDatabaseUrl({ BUILD_CANARY }));
  expect(build.status, build.stderr).toBe(0);

  await ensureTestDatabase(emptyDatabaseUrl);
  client = new pg.Client({ connectionString: emptyDatabaseUrl });
  await client.connect();
  await emptyTheDatabase(client);
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  if (!client) return;
  await emptyTheDatabase(client);
  await client.end();
});

describe('API build output', () => {
  it('produces server, worker and migration entry points that import no TypeScript and no tsx', () => {
    for (const entry of entryPoints) {
      const code = readFileSync(path.join(distDir, entry), 'utf8');
      expect(code, entry).not.toMatch(/from\s*["'][^"']+\.ts["']/);
      expect(code, entry).not.toMatch(/import\(\s*["'][^"']+\.ts["']\s*\)/);
      expect(code, entry).not.toMatch(/["']tsx(\/[^"']*)?["']/);
      expect(code, entry).not.toMatch(/["']@[^/"']+\/shared["']/);
    }
  });

  it('loads the server and worker module graphs with plain node', () => {
    for (const entry of ['server.js', 'worker.js']) {
      // No configuration: the process must get as far as validating its environment and stop there.
      const run = runNode([path.join(distDir, entry)], withoutDatabaseUrl());
      expect(run.status, entry).not.toBe(0);
      expect(run.stderr, entry).not.toMatch(/ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/);
      expect(run.stderr, entry).toMatch(/DATABASE_URL/);
    }
  });

  it('inlines no environment value into the bundles', () => {
    for (const entry of entryPoints) {
      expect(readFileSync(path.join(distDir, entry), 'utf8'), entry).not.toContain(BUILD_CANARY);
    }
  });

  it('applies every migration to an empty database when run with node', async () => {
    const run = runNode([builtMigration], { ...process.env, DATABASE_URL: emptyDatabaseUrl });
    expect(run.status, run.stderr).toBe(0);

    if (!client) throw new Error('the throwaway database is not connected');
    const result = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(result.rows.map((row) => row.tablename)).toEqual(ALL_TABLES);
  });

  it('missing DATABASE_URL error: the built migration exits with code 1 and names the variable', () => {
    const run = runNode([builtMigration], withoutDatabaseUrl());
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('DATABASE_URL is required to run migrations');
  });

  it('migration error: the built migration exits non-zero when the database cannot be reached', () => {
    const run = runNode([builtMigration], {
      ...process.env,
      DATABASE_URL: 'postgres://argent:argent@127.0.0.1:1/argent_unreachable_test',
    });
    expect(run.status).not.toBe(0);
  });

  it('build error: the build exits with code 1 when an entry point does not exist', () => {
    const outdir = mkdtempSync(path.join(tmpdir(), 'argent-build-'));
    try {
      const run = runNode(
        ['scripts/build.mjs', '--outdir', outdir, 'src/does-not-exist.ts'],
        withoutDatabaseUrl(),
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/does-not-exist/);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
