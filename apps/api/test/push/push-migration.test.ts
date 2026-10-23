import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0039_push_notifications';
const WHEN = 1791830000000;
const PREVIOUS_MAX_WHEN = 1791820000000;
const HOOK_TIMEOUT_MS = 60_000;
const P256DH = 'p'.repeat(87);
const AUTH = 'a'.repeat(22);

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_push_migration_test`;
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

async function tableExists(name: string): Promise<boolean> {
  const result = await client.query<{ t: string | null }>('select to_regclass($1) as t', [
    `public.${name}`,
  ]);
  return result.rows[0]?.t !== null;
}

/** Runs one statement and returns its SQLSTATE, or undefined when it succeeds (autocommit, no state left on error). */
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

async function publicTableCount(): Promise<number> {
  const result = await client.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public'",
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

async function noticeId(owner: string, paymentId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into notices (owner_id, kind, payment_id, due_date, text)
     values ($1, 'reminder', $2, '2026-10-12', 'hello') returning id`,
    [owner, paymentId],
  );
  return result.rows[0]?.id ?? '';
}

async function subscriptionId(owner: string, endpoint: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4) returning id`,
    [owner, endpoint, P256DH, AUTH],
  );
  return result.rows[0]?.id ?? '';
}

describe('0039_push_notifications migration', () => {
  it('creates both tables and the nullable notices column', async () => {
    expect(await tableExists('push_subscriptions')).toBe(true);
    expect(await tableExists('push_deliveries')).toBe(true);
    const column = await client.query(
      `select 1 from information_schema.columns
        where table_name = 'notices' and column_name = 'push_handled_at' and is_nullable = 'YES'`,
    );
    expect(column.rowCount).toBe(1);
  });

  it('rejects a duplicate endpoint', async () => {
    const owner = await userId('subs@push.test');
    await subscriptionId(owner, 'https://fcm.googleapis.com/fcm/send/dup');
    expect(
      await sqlState(
        'insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)',
        [owner, 'https://fcm.googleapis.com/fcm/send/dup', P256DH, AUTH],
      ),
    ).toBe('23505');
  });

  it('checks the length of endpoint, p256dh and auth', async () => {
    const owner = await userId('checks@push.test');
    const insert = (endpoint: string, p256dh: string, auth: string) =>
      sqlState(
        'insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)',
        [owner, endpoint, p256dh, auth],
      );
    expect(await insert('', P256DH, AUTH)).toBe('23514');
    expect(await insert(`https://fcm.googleapis.com/${'x'.repeat(2048)}`, P256DH, AUTH)).toBe(
      '23514',
    );
    expect(await insert('https://fcm.googleapis.com/a', 'p'.repeat(86), AUTH)).toBe('23514');
    expect(await insert('https://fcm.googleapis.com/b', P256DH, 'a'.repeat(23))).toBe('23514');
    expect(await insert('https://fcm.googleapis.com/c', P256DH, AUTH)).toBeUndefined();
  });

  it('defaults a delivery to pending with 0 attempts and keeps status and attempts in range', async () => {
    const owner = await userId('deliveries@push.test');
    const notice = await noticeId(owner, '00000000-0000-4000-8000-000000000001');
    const sub = await subscriptionId(owner, 'https://fcm.googleapis.com/d');
    const inserted = await client.query<{ status: string; attempts: number }>(
      'insert into push_deliveries (notice_id, subscription_id) values ($1, $2) returning status, attempts',
      [notice, sub],
    );
    expect(inserted.rows[0]).toEqual({ status: 'pending', attempts: 0 });
    expect(
      await sqlState('insert into push_deliveries (notice_id, subscription_id) values ($1, $2)', [
        notice,
        sub,
      ]),
    ).toBe('23505');
    expect(
      await sqlState("update push_deliveries set status = 'bogus' where notice_id = $1", [notice]),
    ).toBe('23514');
    expect(
      await sqlState('update push_deliveries set attempts = 6 where notice_id = $1', [notice]),
    ).toBe('23514');
    expect(
      await sqlState('update push_deliveries set attempts = -1 where notice_id = $1', [notice]),
    ).toBe('23514');
    expect(
      await sqlState(
        "update push_deliveries set status = 'skipped', attempts = 5 where notice_id = $1",
        [notice],
      ),
    ).toBeUndefined();
  });

  it('cascades from the notice and from the user', async () => {
    const owner = await userId('cascade@push.test');
    const notice = await noticeId(owner, '00000000-0000-4000-8000-000000000002');
    const sub = await subscriptionId(owner, 'https://fcm.googleapis.com/e');
    await client.query('insert into push_deliveries (notice_id, subscription_id) values ($1, $2)', [
      notice,
      sub,
    ]);
    await client.query('delete from notices where id = $1', [notice]);
    expect(
      (await client.query('select 1 from push_deliveries where subscription_id = $1', [sub]))
        .rowCount,
    ).toBe(0);
    await client.query('delete from users where id = $1', [owner]);
    expect(
      (await client.query('select 1 from push_subscriptions where user_id = $1', [owner])).rowCount,
    ).toBe(0);
  });

  it('marks the notices that exist before the migration as handled and leaves new ones unhandled', async () => {
    // 0041 and 0040 have the greater journal `when`, so they go first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    const owner = await userId('before@push.test');
    const before = await noticeId(owner, '00000000-0000-4000-8000-000000000003');
    await runMigrations(throwawayUrl);
    const handled = await client.query<{ push_handled_at: Date | null }>(
      'select push_handled_at from notices where id = $1',
      [before],
    );
    expect(handled.rows[0]?.push_handled_at).not.toBeNull();
    const fresh = await noticeId(owner, '00000000-0000-4000-8000-000000000004');
    const unhandled = await client.query<{ push_handled_at: Date | null }>(
      'select push_handled_at from notices where id = $1',
      [fresh],
    );
    expect(unhandled.rows[0]?.push_handled_at).toBeNull();
  });

  it('is reverted twice by its idempotent rollback, removes only its journal row, and re-applies', async () => {
    const countBefore = await appliedMigrations();
    const tablesBefore = await publicTableCount();
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    // 0041 and 0040 have the greater journal `when`, so they go first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(script);
    await client.query(script);

    expect(await tableExists('push_subscriptions')).toBe(false);
    expect(await tableExists('push_deliveries')).toBe(false);
    const column = await client.query(
      "select 1 from information_schema.columns where table_name = 'notices' and column_name = 'push_handled_at'",
    );
    expect(column.rowCount).toBe(0);
    const index = await client.query(
      "select 1 from pg_indexes where indexname = 'notices_push_unhandled_idx'",
    );
    expect(index.rowCount).toBe(0);
    expect(await appliedMigrations()).toBe(countBefore - 3);
    expect(await publicTableCount()).toBe(tablesBefore - 2);

    await runMigrations(throwawayUrl);
    expect(await appliedMigrations()).toBe(countBefore);
    expect(await tableExists('push_deliveries')).toBe(true);
  });

  it('has a rollback script that forgets exactly the journal when of its migration', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    expect(own?.when).toBe(WHEN);
    expect(script).toContain(`"created_at" = ${WHEN}`);
  });

  it('has the journal entry at idx 39 with the greatest when up to its idx, chained to 0038', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(39);
    expect(own?.when).toBeGreaterThan(PREVIOUS_MAX_WHEN);
    expect(own?.when).toBe(
      Math.max(
        ...journal.entries
          .filter((entry) => entry.idx <= (own?.idx ?? 0))
          .map((entry) => entry.when),
      ),
    );
    const snapshot = JSON.parse(await fileOf('meta/0039_snapshot.json')) as { prevId: string };
    const previous = JSON.parse(await fileOf('meta/0038_snapshot.json')) as { id: string };
    expect(snapshot.prevId).toBe(previous.id);
  });
});
