import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0036_budget_alert_marks';
const PREVIOUS_MAX_WHEN = 1791790000000;
const HOOK_TIMEOUT_MS = 60_000;

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_alert_marks_migration_test`;
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

async function kindCheckDefinition(): Promise<string> {
  const result = await client.query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notices_kind_check'`,
  );
  return result.rows[0]?.def ?? '';
}

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

interface Seed {
  userId: string;
  budgetId: string;
}

async function seedBudget(email: string): Promise<Seed> {
  const user = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language) values ($1, 'h', 'UTC', 'es') returning id`,
    [email],
  );
  const userId = user.rows[0]?.id ?? '';
  const budget = await client.query<{ id: string }>(
    `insert into budgets (owner_id, currency) values ($1, 'ARS') returning id`,
    [userId],
  );
  return { userId, budgetId: budget.rows[0]?.id ?? '' };
}

const insertMark = (budgetId: string, ownerId: string, month: string, threshold: number) =>
  client.query(
    'insert into budget_alert_marks (budget_id, owner_id, month, threshold) values ($1, $2, $3, $4)',
    [budgetId, ownerId, month, threshold],
  );

beforeEach(async () => {
  await client.query('delete from users');
});

describe('0036_budget_alert_marks migration', () => {
  it('creates the table, widens the kind check and declares no float column', async () => {
    expect(await tableExists('budget_alert_marks')).toBe(true);
    const check = await kindCheckDefinition();
    for (const kind of [
      'reminder',
      'recorded',
      'not_recorded',
      'card_statement_due',
      'budget_alert',
    ]) {
      expect(check).toContain(`'${kind}'`);
    }
    const floats = await client.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name in ('budget_alert_marks', 'notices')
          and data_type in ('real', 'double precision', 'numeric')`,
    );
    expect(floats.rowCount).toBe(0);
  });

  it('refuses a duplicate mark and accepts another month or threshold', async () => {
    const { userId, budgetId } = await seedBudget('dup@marks.test');
    await insertMark(budgetId, userId, '2026-10-01', 80);

    await expect(insertMark(budgetId, userId, '2026-10-01', 80)).rejects.toMatchObject({
      code: '23505',
    });
    await insertMark(budgetId, userId, '2026-11-01', 80);
    await insertMark(budgetId, userId, '2026-10-01', 100);
  });

  it('refuses a mark of another owner, a threshold out of range and a month that is not the first', async () => {
    const { budgetId } = await seedBudget('owner@marks.test');
    const other = await seedBudget('other@marks.test');
    const own = await client.query<{ owner_id: string }>(
      'select owner_id from budgets where id = $1',
      [budgetId],
    );

    await expect(insertMark(budgetId, other.userId, '2026-10-01', 80)).rejects.toMatchObject({
      code: '23503',
    });
    await expect(
      insertMark(budgetId, own.rows[0]?.owner_id ?? '', '2026-10-01', 0),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertMark(budgetId, own.rows[0]?.owner_id ?? '', '2026-10-01', 201),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertMark(budgetId, own.rows[0]?.owner_id ?? '', '2026-10-15', 80),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('deletes the marks with the budget and with the user', async () => {
    const first = await seedBudget('cascade-a@marks.test');
    const second = await seedBudget('cascade-b@marks.test');
    await insertMark(first.budgetId, first.userId, '2026-10-01', 80);
    await insertMark(second.budgetId, second.userId, '2026-10-01', 80);

    await client.query('delete from budgets where id = $1', [first.budgetId]);
    const afterBudget = await client.query('select 1 from budget_alert_marks');
    expect(afterBudget.rowCount).toBe(1);

    await client.query('delete from users where id = $1', [second.userId]);
    const afterUser = await client.query('select 1 from budget_alert_marks');
    expect(afterUser.rowCount).toBe(0);
  });

  it('accepts a budget_alert notice and refuses an unknown kind', async () => {
    const { userId } = await seedBudget('notice@marks.test');
    const insertNotice = (kind: string) =>
      client.query(
        `insert into notices (owner_id, kind, payment_id, due_date, text)
         values ($1, $2, gen_random_uuid(), '2026-10-01', 'x')`,
        [userId, kind],
      );

    await insertNotice('budget_alert');
    await expect(insertNotice('made_up')).rejects.toMatchObject({ code: '23514' });
  });

  it('is reverted by its idempotent rollback, which removes only its own journal row, and re-applies', async () => {
    const { userId } = await seedBudget('rollback@marks.test');
    await client.query(
      `insert into notices (owner_id, kind, payment_id, due_date, text)
       values ($1, 'budget_alert', gen_random_uuid(), '2026-10-01', 'x'),
              ($1, 'reminder', gen_random_uuid(), '2026-10-01', 'y')`,
      [userId],
    );
    // 0037 has the greater journal `when`, so it goes first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    const countBefore = await appliedMigrations();

    // 0037 has the greater journal `when`, so it goes first: the migrator replays only what is newer.
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await tableExists('budget_alert_marks')).toBe(false);
    expect(await appliedMigrations()).toBe(countBefore - 2);
    expect(await kindCheckDefinition()).not.toContain('budget_alert');
    const notices = await client.query<{ kind: string }>('select kind from notices');
    expect(notices.rows.map((row) => row.kind)).toEqual(['reminder']);

    await runMigrations(throwawayUrl);

    expect(await tableExists('budget_alert_marks')).toBe(true);
    expect(await kindCheckDefinition()).toContain('budget_alert');
    // runMigrations also re-applies 0037, which was rolled back first.
    expect(await appliedMigrations()).toBe(countBefore + 1);
  });

  it('has a rollback script that forgets exactly the journal when of its migration', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);
    const script = await fileOf(`rollback/${TAG}.down.sql`);

    expect(own?.when).toBe(1791800000000);
    expect(script).toContain(`"created_at" = ${own?.when}`);
  });

  it('has the journal entry at idx 36 with the greatest when, chained to 0035', async () => {
    const journal = JSON.parse(await fileOf('meta/_journal.json')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(36);
    expect(own?.when).toBeGreaterThan(PREVIOUS_MAX_WHEN);
    // 0037 and 0038 come after it, so it is the greatest among its own and the older ones.
    expect(own?.when).toBe(
      Math.max(
        ...journal.entries
          .filter((entry) => entry.idx <= 36)
          .map((entry) => entry.when),
      ),
    );
    const snapshot = JSON.parse(await fileOf('meta/0036_snapshot.json')) as { prevId: string };
    const previous = JSON.parse(await fileOf('meta/0035_snapshot.json')) as { id: string };
    expect(snapshot.prevId).toBe(previous.id);
  });
});
