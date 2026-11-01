import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const TAG = '0032_card_statement_reminders';
const PREVIOUS_WHEN = 1791760000000;
const KIND = 'card_statement_due';

/** A throwaway database next to the test database, so the chain can be rolled back freely. */
const throwawayUrl = (() => {
  const url = new URL(testDatabaseUrl);
  const testName = url.pathname.replace(/^\//, '').replace(/_test$/, '');
  url.pathname = `/${testName}_statement_reminders_migration_test`;
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

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function cardColumns(): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'credit_cards' order by column_name`,
  );
  return result.rows.map((row) => row.column_name);
}

async function sqlState(statement: string, values: unknown[] = []): Promise<string | undefined> {
  try {
    await client.query(statement, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function createUser(email: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language)
     values ($1, 'h', 'UTC', 'es') returning id`,
    [email],
  );
  return result.rows[0]?.id ?? '';
}

async function createAccount(owner: string, currency: 'ARS' | 'USD'): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
     values ($1, $2, 'cash', $3, 0, true) returning id`,
    [owner, `Caja ${randomUUID()}`, currency],
  );
  return result.rows[0]?.id ?? '';
}

/** Inserts a card; `reminderDays` undefined leaves the column to its default. */
async function createCard(reminderDays?: number): Promise<string> {
  const owner = await createUser(`${randomUUID()}@reminders.test`);
  const ars = await createAccount(owner, 'ARS');
  const usd = await createAccount(owner, 'USD');
  const result = await client.query<{ id: string }>(
    `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
     values ($1, 'Visa', 10, 20, $2, $3) returning id`,
    [owner, ars, usd],
  );
  const id = result.rows[0]?.id ?? '';
  if (reminderDays !== undefined) await setReminderDays(id, reminderDays);
  return id;
}

const setReminderDays = (card: string, days: number) =>
  sqlState('update credit_cards set reminder_days = $2 where id = $1', [card, days]);

const reminderDaysOf = async (card: string): Promise<number | undefined> =>
  (
    await client.query<{ reminder_days: number }>(
      'select reminder_days from credit_cards where id = $1',
      [card],
    )
  ).rows[0]?.reminder_days;

const insertNotice = (owner: string, kind: string, paymentId: string, dueDate: string) =>
  sqlState(
    `insert into notices (owner_id, kind, payment_id, due_date, text) values ($1, $2, $3, $4, 'Texto')`,
    [owner, kind, paymentId, dueDate],
  );

const noticeKinds = async (owner: string): Promise<string[]> =>
  (
    await client.query<{ kind: string }>(
      'select kind from notices where owner_id = $1 order by kind',
      [owner],
    )
  ).rows.map((row) => row.kind);

describe('0032_card_statement_reminders migration', () => {
  it('gives existing cards 3 after a rollback re-apply, and a new card without the field 3 (AC-01)', async () => {
    await client.query(await fileOf('rollback/0042_card_category_rules.down.sql'));
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    await client.query(await fileOf('rollback/0035_group_expense_payer_movement_idx.down.sql'));
    await client.query(await fileOf('rollback/0034_budgets.down.sql'));
    await client.query(await fileOf('rollback/0033_savings_goals.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    const existing = await createCard();

    await runMigrations(throwawayUrl);

    expect(await reminderDaysOf(existing)).toBe(3);
    expect(await reminderDaysOf(await createCard())).toBe(3);
    expect(await reminderDaysOf(await createCard(7))).toBe(7);
  });

  it('accepts 0 and 30 and refuses -1 and 31 with the named check (AC-03)', async () => {
    const card = await createCard();

    expect(await setReminderDays(card, 0)).toBeUndefined();
    expect(await setReminderDays(card, 30)).toBeUndefined();
    expect(await setReminderDays(card, -1)).toBe('23514');
    expect(await setReminderDays(card, 31)).toBe('23514');
    expect(await reminderDaysOf(card)).toBe(30);

    const named = await client.query(
      `select 1 from pg_constraint where conname = 'credit_cards_reminder_days_check'`,
    );
    expect(named.rowCount).toBe(1);
  });

  it('accepts a notice of kind card_statement_due and refuses an unknown kind (FR-01)', async () => {
    const owner = await createUser('kinds@reminders.test');

    expect(await insertNotice(owner, KIND, randomUUID(), '2026-10-20')).toBeUndefined();
    expect(await insertNotice(owner, 'other', randomUUID(), '2026-10-20')).toBe('23514');
  });

  it('refuses a duplicate (kind, statement, due date) and accepts another due date (AC-05)', async () => {
    const owner = await createUser('duplicates@reminders.test');
    const statement = randomUUID();

    expect(await insertNotice(owner, KIND, statement, '2026-10-20')).toBeUndefined();
    expect(await insertNotice(owner, KIND, statement, '2026-10-20')).toBe('23505');
    expect(await insertNotice(owner, KIND, statement, '2026-11-20')).toBeUndefined();
  });

  it('is reverted by its rollback, which runs twice, deleting only the new notices, and re-applies (FR-01, NFR-02)', async () => {
    const owner = await createUser('rollback@reminders.test');
    await insertNotice(owner, 'reminder', randomUUID(), '2026-10-20');
    await insertNotice(owner, 'recorded', randomUUID(), '2026-10-20');
    await insertNotice(owner, 'not_recorded', randomUUID(), '2026-10-20');
    await insertNotice(owner, KIND, randomUUID(), '2026-10-20');
    const before = await cardColumns();
    const countBefore = await appliedMigrations();

    await client.query(await fileOf('rollback/0042_card_category_rules.down.sql'));
    await client.query(await fileOf('rollback/0041_group_notices.down.sql'));
    await client.query(await fileOf('rollback/0040_balance_adjustments.down.sql'));
    await client.query(await fileOf('rollback/0039_push_notifications.down.sql'));
    await client.query(await fileOf('rollback/0038_exchange_rate_history.down.sql'));
    await client.query(await fileOf('rollback/0037_group_expense_from_movement.down.sql'));
    await client.query(await fileOf('rollback/0036_budget_alert_marks.down.sql'));
    await client.query(await fileOf('rollback/0035_group_expense_payer_movement_idx.down.sql'));
    await client.query(await fileOf('rollback/0034_budgets.down.sql'));
    await client.query(await fileOf('rollback/0033_savings_goals.down.sql'));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));
    await client.query(await fileOf(`rollback/${TAG}.down.sql`));

    expect(await cardColumns()).toEqual(before.filter((name) => name !== 'reminder_days'));
    expect(await noticeKinds(owner)).toEqual(['not_recorded', 'recorded', 'reminder']);
    expect(await insertNotice(owner, KIND, randomUUID(), '2026-10-21')).toBe('23514');
    expect(await appliedMigrations()).toBe(countBefore - 10);

    await runMigrations(throwawayUrl);

    expect(await appliedMigrations()).toBe(countBefore);
    expect(await cardColumns()).toEqual(before);
    expect(await insertNotice(owner, KIND, randomUUID(), '2026-10-21')).toBeUndefined();
  });

  it('has the journal entry at idx 32 with the greatest when before 0033 to 0041, and chains its snapshot onto 0031', async () => {
    const read = async <T>(name: string) => JSON.parse(await fileOf(`meta/${name}`)) as T;
    const journal = await read<{ entries: { idx: number; when: number; tag: string }[] }>(
      '_journal.json',
    );
    const own = journal.entries.find((entry) => entry.tag === TAG);

    expect(own?.idx).toBe(32);
    expect(own?.when).toBeGreaterThan(PREVIOUS_WHEN);
    expect(own?.when).toBe(
      Math.max(
        ...journal.entries
          .filter(
            (entry) =>
              ![
                '0033_savings_goals',
                '0034_budgets',
                '0035_group_expense_payer_movement_idx',
                '0036_budget_alert_marks',
                '0037_group_expense_from_movement',
                '0038_exchange_rate_history',
                '0039_push_notifications',
                '0040_balance_adjustments',
                '0041_group_notices',
                '0042_card_category_rules',
              ].includes(entry.tag),
          )
          .map((entry) => entry.when),
      ),
    );
    expect((await read<{ prevId: string }>('0032_snapshot.json')).prevId).toBe(
      (await read<{ id: string }>('0031_snapshot.json')).id,
    );
  });
});
