import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0041_group_notices';
const WHEN = 1792780077683;
const PREVIOUS_MAX_WHEN = 1791937632948;
const HOOK_TIMEOUT_MS = 60_000;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_group_notices_migration_test`;
  return url.toString();
})();

let client: pg.Client;

async function emptyTheDatabase(target: pg.Client): Promise<void> {
  await target.query('drop schema if exists drizzle cascade');
  await target.query('drop schema if exists public cascade');
  await target.query('create schema public');
}

beforeAll(async () => {
  await ensureTestDatabase(throwawayUrl);
  client = new pg.Client({ connectionString: throwawayUrl });
  await client.connect();
  await emptyTheDatabase(client);
  await runMigrations(throwawayUrl);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await emptyTheDatabase(client);
  await client.end();
}, HOOK_TIMEOUT_MS);

const fileOf = (relative: string) => readFile(`${migrationsFolder}/${relative}`, 'utf8');

async function sqlState(text: string, values: unknown[] = []): Promise<string | undefined> {
  try {
    await client.query(text, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function userId(email: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language) values ($1, 'h', 'UTC', 'es') returning id`,
    [email],
  );
  return result.rows[0]?.id ?? '';
}

function insertNotice(
  owner: string,
  kind: string,
  subject: string,
  groupId: string | null,
): Promise<string | undefined> {
  return sqlState(
    `insert into notices (owner_id, kind, payment_id, due_date, text, group_id)
     values ($1, $2, $3, '2026-10-23', 'x', $4)`,
    [owner, kind, subject, groupId],
  );
}

async function constraintNames(): Promise<string[]> {
  const result = await client.query<{ conname: string }>(
    `select conname from pg_constraint where conrelid = 'public.notices'::regclass order by conname`,
  );
  return result.rows.map((row) => row.conname);
}

describe('0041_group_notices migration', () => {
  it('gives each member involved in one group expense their own notice', async () => {
    const ana = await userId('ana@group-notices.test');
    const bob = await userId('bob@group-notices.test');
    const expense = randomUUID();
    const group = randomUUID();

    expect(await insertNotice(ana, 'group_expense', expense, group)).toBeUndefined();
    expect(await insertNotice(bob, 'group_expense', expense, group)).toBeUndefined();
    expect(await insertNotice(bob, 'group_expense', expense, group)).toBe('23505');
    expect(await insertNotice(ana, 'group_settlement', randomUUID(), group)).toBeUndefined();
  });

  it('requires a group id exactly on the group kinds and refuses an unknown kind', async () => {
    const owner = await userId('checks@group-notices.test');

    expect(await insertNotice(owner, 'group_expense', randomUUID(), null)).toBe('23514');
    expect(await insertNotice(owner, 'reminder', randomUUID(), randomUUID())).toBe('23514');
    expect(await insertNotice(owner, 'reminder', randomUUID(), null)).toBeUndefined();
    expect(await insertNotice(owner, 'made_up', randomUUID(), null)).toBe('23514');
  });

  it('is reverted by its idempotent rollback, deleting only the group notices, and re-applies', async () => {
    const owner = await userId('rollback@group-notices.test');
    await insertNotice(owner, 'group_expense', randomUUID(), randomUUID());
    await insertNotice(owner, 'reminder', randomUUID(), null);
    const countBefore = await appliedMigrations();
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    await client.query(script);
    await client.query(script);

    const kinds = await client.query<{ kind: string }>(
      'select kind from notices where owner_id = $1',
      [owner],
    );
    expect(kinds.rows.map((row) => row.kind)).toEqual(['reminder']);
    const column = await client.query(
      `select 1 from information_schema.columns where table_name = 'notices' and column_name = 'group_id'`,
    );
    expect(column.rowCount).toBe(0);
    expect(await constraintNames()).toContain('notices_kind_payment_due_unique');
    expect(await constraintNames()).not.toContain('notices_owner_kind_payment_due_unique');
    expect(await appliedMigrations()).toBe(countBefore - 1);

    await runMigrations(throwawayUrl);

    expect(await appliedMigrations()).toBe(countBefore);
    expect(await constraintNames()).toContain('notices_owner_kind_payment_due_unique');
    expect(await constraintNames()).toContain('notices_group_id_check');
    expect(await constraintNames()).not.toContain('notices_kind_payment_due_unique');
  });

  it('has a rollback script that forgets exactly the journal when of its migration', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.when).toBe(WHEN);
    expect(await fileOf(`rollback/${TAG}.down.sql`)).toContain(`"created_at" = ${WHEN}`);
  });

  it('has the journal entry at idx 41 with the greatest when up to its idx, chained to 0040', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(41);
    expect(own?.when).toBeGreaterThan(PREVIOUS_MAX_WHEN);
    expect(own?.when).toBe(
      Math.max(
        ...journal.entries
          .filter((entry) => entry.idx <= (own?.idx ?? 0))
          .map((entry) => entry.when),
      ),
    );
    const snapshot = JSON.parse(await fileOf('meta/0041_snapshot.json')) as { prevId: string };
    const previous = JSON.parse(await fileOf('meta/0040_snapshot.json')) as { id: string };
    expect(snapshot.prevId).toBe(previous.id);
  });
});
