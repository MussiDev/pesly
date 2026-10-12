import { createServer, type Server } from 'node:http';
import {
  addMonths,
  expensesByCategoryResponseSchema,
  incomeExpensesResponseSchema,
  netWorthResponseSchema,
  todayInTimeZone,
} from '@pesly/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReportRoutes } from '../../src/reports';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { removeDataset, seedDataset, type SeededDataset } from './movements-seed';

/**
 * NFR-01 benchmark of the three reports (09a, AC-47): 100,000 movements re-dated over 24 months,
 * 50 stored rates, group expenses with shares, installment purchases and portfolio snapshots.
 * Timing dependent: run it with `pnpm test:perf`.
 */

const RUNS = 20;
const WARM_UP_RUNS = 2;
const MAX_P95_MS = 2000;
const RATES = 50;
const GROUP_EXPENSES = 2000;
const PURCHASES = 100;
const INSTALLMENTS_PER_PURCHASE = 12;
const SNAPSHOT_DAYS = 120;
const TIME_ZONE = 'America/Cordoba';
const PASSWORD = 'a long enough passphrase';
const SPAN_SECONDS = 720 * 86_400;

let connection: DatabaseConnection;
let pool: pg.Pool;
let server: Server | undefined;
let ownerId: string | undefined;
let groupId: string | undefined;

beforeAll(() => {
  assertIsTestDatabase(testDatabaseUrl);
  connection = createDatabase(testDatabaseUrl);
  pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
});

afterAll(async () => {
  if (server) {
    const closing = server;
    await new Promise<void>((resolve) => {
      closing.close(() => {
        resolve();
      });
    });
  }
  try {
    assertIsTestDatabase(testDatabaseUrl);
    if (ownerId) {
      await pool.query('delete from installment_purchases where owner_id = $1', [ownerId]);
      await pool.query('delete from credit_cards where owner_id = $1', [ownerId]);
      await pool.query('delete from portfolios where owner_id = $1', [ownerId]);
    }
    if (groupId) {
      await pool.query('delete from group_expense_shares where group_id = $1', [groupId]);
      await pool.query('delete from group_expenses where group_id = $1', [groupId]);
      await pool.query('delete from groups where id = $1', [groupId]);
    }
    await pool.query("delete from exchange_rate_history where rate_type = 'mep'");
    await pool.query("delete from exchange_rates where rate_type = 'mep'");
    if (ownerId) await removeDataset(pool, ownerId);
  } finally {
    await pool.end();
    await connection.pool.end();
  }
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

async function listen(app: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(app);
  const target = server;
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const address = target.address();
  if (!address || typeof address !== 'object') throw new Error('server not listening');
  return `http://127.0.0.1:${address.port}`;
}

/** One round trip; the elapsed time covers the whole response, parsed by the caller afterwards. */
async function timed(url: string, cookie: string): Promise<{ ms: number; body: unknown }> {
  const started = performance.now();
  const response = await fetch(url, { headers: { cookie } });
  const text = await response.text();
  const ms = performance.now() - started;
  if (response.status !== 200) throw new Error(`${response.status} ${text}`);
  return { ms, body: JSON.parse(text) as unknown };
}

/** The 100,000 seeded movements land over 720 days instead of the last 28 hours. */
async function redate(userId: string): Promise<void> {
  await pool.query(
    `with ranked as (
       select id, row_number() over (order by id) as rn from movements where owner_id = $1
     )
     update movements m
        set occurred_at = now() - make_interval(secs => ((r.rn * 7919) % $2::int))
       from ranked r where m.id = r.id`,
    [userId, SPAN_SECONDS],
  );
}

async function seedRates(): Promise<void> {
  await pool.query(
    `insert into exchange_rate_history (rate_type, rate_date, buy, sell, recorded_at)
     select 'mep', (current_date - (n * 14))::date, 10000000 + n * 1000, 10000000 + n * 1000, now()
       from generate_series(1, $1::int) as n`,
    [RATES],
  );
  await pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 14000000, 14000000, now(), now())`,
  );
}

async function seedGroup(userId: string, categoryName: string): Promise<void> {
  const group = await pool.query<{ id: string }>(
    "insert into groups (name, default_rate_type) values ('Perf group', 'blue') returning id",
  );
  const id = group.rows[0]?.id;
  if (!id) throw new Error('The group insert returned no row');
  groupId = id;
  await pool.query('insert into group_members (group_id, user_id) values ($1, $2)', [id, userId]);
  await pool.query("insert into group_members (group_id, display_name) values ($1, 'Ghost')", [id]);
  // One group category matches the user's seeded expense category by name, one matches nothing.
  await pool.query(
    `insert into group_categories (group_id, name, icon, color)
     values ($1, $2, 'wallet', 'blue'), ($1, 'Nothing like it', 'wallet', 'blue')`,
    [id, categoryName],
  );
  await pool.query(
    `with me as (select id from group_members where group_id = $1 and user_id = $2),
          ghost as (select id from group_members where group_id = $1 and user_id is null),
          cats as (select id, row_number() over (order by name) as k from group_categories where group_id = $1)
     insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
                                 occurred_at, category_id, description, split_mode)
     select $1,
            case when g % 2 = 0 then (select id from me) else (select id from ghost) end,
            (select id from me), (g % 500 + 2) * 100, case when g % 5 = 0 then 'USD' else 'ARS' end,
            now() - make_interval(days => (g % 700)::int, secs => (g % 3600)::int),
            cats.id, 'Dinner', 'exact'
       from generate_series(1, $3::int) as g
       join cats on cats.k = (g % 2) + 1`,
    [id, userId, GROUP_EXPENSES],
  );
  await pool.query(
    `insert into group_expense_shares (expense_id, member_id, group_id, amount)
     select e.id, gm.id, $1,
            case when gm.user_id is not null then e.amount / 2 else e.amount - e.amount / 2 end
       from group_expenses e join group_members gm on gm.group_id = e.group_id
      where e.group_id = $1`,
    [id],
  );
}

async function seedInstallments(userId: string, categoryId: string): Promise<void> {
  const accounts = await pool.query<{ id: string; currency: string }>(
    "select id, currency from accounts where owner_id = $1 and name in ('Account 1', 'Account 2')",
    [userId],
  );
  const ars = accounts.rows.find((row) => row.currency === 'ARS')?.id;
  const usd = accounts.rows.find((row) => row.currency === 'USD')?.id;
  if (!ars || !usd) throw new Error('The seed has no ARS and USD cash account');
  const card = await pool.query<{ id: string }>(
    `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
     values ($1, 'Perf Visa', 20, 5, $2, $3) returning id`,
    [userId, ars, usd],
  );
  const cardId = card.rows[0]?.id;
  if (!cardId) throw new Error('The card insert returned no row');
  await pool.query(
    `insert into installment_purchases (owner_id, card_id, category_id, total_amount, currency,
                                        installment_count, purchased_on)
     select $1, $2, $3, (1000 + p) * $5::int, case when p % 4 = 0 then 'USD' else 'ARS' end, $5::int,
            current_date - (p % 20) * 30
       from generate_series(1, $4::int) as p`,
    [userId, cardId, categoryId, PURCHASES, INSTALLMENTS_PER_PURCHASE],
  );
  await pool.query(
    `insert into installments (purchase_id, owner_id, number, period, amount)
     select ip.id, $1, n,
            to_char(date_trunc('month', current_date) - make_interval(months => (rn % 20)::int)
                    + make_interval(months => n - 1), 'YYYY-MM'),
            ip.total_amount / $2::int
       from (select id, total_amount, row_number() over (order by id) as rn
               from installment_purchases where owner_id = $1) ip
      cross join generate_series(1, $2::int) as n`,
    [userId, INSTALLMENTS_PER_PURCHASE],
  );
}

async function seedSnapshots(userId: string): Promise<void> {
  const portfolio = await pool.query<{ id: string }>(
    "insert into portfolios (owner_id, name, created_at) values ($1, 'Perf broker', now() - interval '800 days') returning id",
    [userId],
  );
  const portfolioId = portfolio.rows[0]?.id;
  if (!portfolioId) throw new Error('The portfolio insert returned no row');
  await pool.query(
    `insert into portfolio_value_snapshots (portfolio_id, owner_id, snapshot_date, currency, total_value, taken_at)
     select $1, $2, (current_date - n * 6)::date, 'ARS', 1000000 + n * 1000, now()
       from generate_series(0, $3::int - 1) as n`,
    [portfolioId, userId, SNAPSHOT_DAYS],
  );
}

describe('reports latency (NFR-01, AC-47)', () => {
  it('answers each report under 2 s at p95 over 20 runs for 100,000 movements', async () => {
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createReportRoutes({
          db: connection.db,
          logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
        }),
      ],
    });
    const email = 'perf-reports@example.com';
    const userId = await seedUser(connection, { email, password: PASSWORD, timeZone: TIME_ZONE });
    ownerId = userId;
    const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
    const dataset: SeededDataset = await seedDataset(pool, userId);
    await redate(userId);
    await seedRates();
    const category = await pool.query<{ name: string }>(
      'select name from categories where id = $1',
      [dataset.expenseCategoryId],
    );
    await seedGroup(userId, category.rows[0]?.name ?? '');
    await seedInstallments(userId, dataset.expenseCategoryId);
    await seedSnapshots(userId);
    for (const table of [
      'movements',
      'exchange_rate_history',
      'group_expenses',
      'group_expense_shares',
      'installments',
      'installment_purchases',
      'portfolio_value_snapshots',
    ]) {
      await pool.query(`analyze ${table}`);
    }

    const url = await listen(harness.app);
    const cookie = cookieHeader(cookies);
    const today = todayInTimeZone(new Date(), TIME_ZONE);
    const range = (months: number) =>
      `from=${addMonths(today.slice(0, 7), -(months - 1))}-01&to=${today}`;
    const reports = [
      { name: 'expenses by category', path: `/reports/expenses-by-category?${range(24)}` },
      { name: 'income and expenses', path: `/reports/income-expenses?${range(12)}` },
      { name: 'net worth', path: `/reports/net-worth?${range(24)}` },
    ] as const;

    const measured: string[] = [];
    for (const report of reports) {
      for (let run = 0; run < WARM_UP_RUNS; run += 1) await timed(`${url}${report.path}`, cookie);
      const latencies: number[] = [];
      let last: unknown;
      for (let run = 0; run < RUNS; run += 1) {
        const result = await timed(`${url}${report.path}`, cookie);
        latencies.push(result.ms);
        last = result.body;
      }
      // Real figures, so a reader answering with empty rows cannot pass.
      if (report.name === 'expenses by category') {
        const body = expensesByCategoryResponseSchema.parse(last);
        expect(BigInt(body.total)).toBeGreaterThan(0n);
        expect(body.categories.length).toBeGreaterThan(0);
      } else if (report.name === 'income and expenses') {
        const body = incomeExpensesResponseSchema.parse(last);
        expect(body.months).toHaveLength(12);
        expect(body.months.some((month) => BigInt(month.income) > 0n)).toBe(true);
      } else {
        const body = netWorthResponseSchema.parse(last);
        expect(body.points).toHaveLength(24);
        expect(body.points.some((point) => point.total !== null)).toBe(true);
      }
      const p95 = percentile(latencies, 95);
      measured.push(
        `${report.name}: p95 = ${Math.trunc(p95 * 10) / 10} ms (limit ${MAX_P95_MS} ms)`,
      );
      expect(p95, report.name).toBeLessThan(MAX_P95_MS);
    }
    console.log(
      `[NFR-01] reports over 100,000 movements, ${RUNS} runs each\n${measured.join('\n')}`,
    );
  }, 600_000);
});
