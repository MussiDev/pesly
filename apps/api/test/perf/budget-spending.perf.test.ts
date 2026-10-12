import { createServer, type Server } from 'node:http';
import {
  budgetSpendingListResponseSchema,
  type BudgetSpendingListResponse,
  type BudgetSpendingResponse,
} from '@pesly/shared';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBudgetRoutes } from '../../src/budgets';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { removeDataset, seedDataset } from './movements-seed';

/**
 * NFR-01 benchmark of `GET /budgets/spending` (06c): 50 budgets of two versions each over 50
 * expense categories, 100,000 real movements and 5,000 group expenses with shares. Timing
 * dependent: run it with `pnpm test:perf`.
 */

const REQUESTS = 300;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_P95_MS = 500;
const BUDGETS = 50;
const GROUP_EXPENSES = 5000;
/** The only zone the seeded user lives in, and the one the control SQL computes months in. */
const TIME_ZONE = 'America/Cordoba';
/** Every seeded expense movement is frozen at ARS 1,400.0000 per USD. */
const SEEDED_RATE = 14000000n;
const PASSWORD = 'a long enough passphrase';
/** Budgets named in the control: all in ARS, 4 with rollover on, 2 and 4 matched by group shares. */
const CONTROLLED = [2, 4, 10, 50];

let connection: DatabaseConnection;
let pool: pg.Pool;
let server: Server | undefined;
const seededUsers: string[] = [];
let datasetOwner: string | undefined;

beforeAll(() => {
  assertIsTestDatabase(testDatabaseUrl);
  connection = createDatabase(testDatabaseUrl);
  pool = new pg.Pool({ connectionString: testDatabaseUrl, max: CONNECTIONS });
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
    // Budgets first: their category keys restrict the category delete. Groups cascade their rows.
    for (const id of seededUsers) {
      await pool.query('delete from budgets where owner_id = $1', [id]);
      await pool.query(
        'delete from groups where id in (select group_id from group_members where user_id = $1)',
        [id],
      );
    }
    if (datasetOwner) await removeDataset(pool, datasetOwner);
    for (const id of seededUsers) {
      if (id !== datasetOwner) {
        await pool.query('delete from categories where owner_id = $1', [id]);
        await pool.query('delete from users where id = $1', [id]);
      }
    }
  } finally {
    await pool.end();
    await connection.pool.end();
  }
});

/** SQL for a deterministic, well-formed (version 4, variant 8) uuid from the text of `source`. */
function uuidOf(source: string): string {
  return `regexp_replace(md5(${source}), '^(.{8})(.{4}).(.{3}).(.{3})(.{12})$', '\\1-\\2-4\\3-8\\4-\\5')::uuid`;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

async function startApp(userEmail: string) {
  const routes = createBudgetRoutes({
    db: connection.db,
    logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes],
  });
  const userId = await seedUser(connection, {
    email: userEmail,
    password: PASSWORD,
    timeZone: TIME_ZONE,
  });
  seededUsers.push(userId);
  const cookies = sessionFrom(await signIn(harness.app, userEmail, PASSWORD));
  return { harness, userId, cookies };
}

async function listen(app: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(app);
  const target = server;
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const address = target.address();
  if (!address || typeof address !== 'object') throw new Error('server not listening');
  return `http://127.0.0.1:${address.port}`;
}

async function load(url: string, cookie: string, amount: number) {
  const statuses = new Map<number, number>();
  const latencies: number[] = [];
  await new Promise<void>((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: CONNECTIONS,
        amount,
        timeout: 30,
        requests: [{ method: 'GET', path: '/budgets/spending', headers: { cookie } }],
      },
      (error) => {
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve();
      },
    );
    instance.on('response', (_client, statusCode, _bytes, responseTime) => {
      statuses.set(statusCode, (statuses.get(statusCode) ?? 0) + 1);
      latencies.push(responseTime);
    });
  });
  return { statuses, latencies };
}

async function readSpending(url: string, cookie: string): Promise<BudgetSpendingListResponse> {
  const response = await fetch(`${url}/budgets/spending`, { headers: { cookie } });
  if (response.status !== 200) throw new Error(`${response.status} ${await response.text()}`);
  return budgetSpendingListResponseSchema.parse(await response.json());
}

/**
 * 50 expense categories 'Spend n' take the seeded expenses (spread over the previous and the
 * current month in the user's zone), and 50 budgets cover one each, with a version in both months.
 */
async function seedBudgets(userId: string): Promise<void> {
  await pool.query(
    `insert into categories (owner_id, kind, name, icon, color)
     select $1, 'expense', 'Spend ' || n, 'wallet', 'blue' from generate_series(1, $2::int) as n`,
    [userId, BUDGETS],
  );
  await pool.query(
    `with cats as (
       select id, substring(name from 7)::int as k from categories
        where owner_id = $1 and name like 'Spend %'
     ), ranked as (
       select id, row_number() over (order by id) as rn from movements
        where owner_id = $1 and type = 'expense'
     )
     update movements m
        set category_id = cats.id,
            occurred_at = (date_trunc('month', timezone($3, now()))
                           - make_interval(months => (r.rn / 50 % 2)::int)
                           + make_interval(days => (r.rn / 3 % 28)::int, secs => (r.rn % 3600)::int))
                          at time zone $3
       from ranked r join cats on cats.k = (r.rn % $2::int) + 1
      where m.id = r.id`,
    [userId, BUDGETS, TIME_ZONE],
  );
  // Budget n: ARS when even, USD when odd; rollover on when n % 4 is 0 or 1; covers 'Spend n'.
  await pool.query(
    `insert into budgets (id, owner_id, currency)
     select ${uuidOf("$1::uuid::text || ':budget:' || n")}, $1, case when n % 2 = 0 then 'ARS' else 'USD' end
       from generate_series(1, $2::int) as n`,
    [userId, BUDGETS],
  );
  await pool.query(
    `insert into budget_versions (id, budget_id, owner_id, effective_from, name, amount, rollover)
     select ${uuidOf("$1::uuid::text || ':version:' || n || ':' || m")}, ${uuidOf("$1::uuid::text || ':budget:' || n")},
            $1,
            (date_trunc('month', timezone($3, now())) - make_interval(months => m))::date,
            'Budget ' || n,
            case when m = 0 then 100000000 + n else 90000000 + n end,
            n % 4 < 2
       from generate_series(1, $2::int) as n cross join generate_series(0, 1) as m`,
    [userId, BUDGETS, TIME_ZONE],
  );
  await pool.query(
    `insert into budget_version_categories (version_id, owner_id, category_id)
     select v.id, $1, c.id
       from budget_versions v
       join categories c on c.owner_id = $1 and c.name = 'Spend ' || substring(v.name from 8)
      where v.owner_id = $1`,
    [userId],
  );
  await pool.query(
    `insert into budget_version_thresholds (version_id, owner_id, percent)
     select id, $1, p from budget_versions cross join (values (80), (100)) as t(p)
      where owner_id = $1`,
    [userId],
  );
}

/**
 * A group with the user and a ghost, group categories 'spend 1'..'spend 5' (lower case on
 * purpose), 5,000 ARS expenses of which the user paid the even ones, 500 of those through an
 * existing expense of 'Spend 2' or 'Spend 4' (whose payer movement must then count once).
 */
async function seedGroup(userId: string): Promise<void> {
  const group = await pool.query<{ id: string }>(
    "insert into groups (name, default_rate_type) values ('Perf group', 'blue') returning id",
  );
  const groupId = group.rows[0]?.id;
  if (!groupId) throw new Error('The group insert returned no row');
  await pool.query('insert into group_members (group_id, user_id) values ($1, $2)', [
    groupId,
    userId,
  ]);
  await pool.query("insert into group_members (group_id, display_name) values ($1, 'Ghost')", [
    groupId,
  ]);
  await pool.query(
    `insert into group_categories (group_id, name, icon, color)
     select $1, 'spend ' || n, 'wallet', 'blue' from generate_series(1, 5) as n`,
    [groupId],
  );
  await pool.query(
    `with me as (select id from group_members where group_id = $1 and user_id = $2),
          ghost as (select id from group_members where group_id = $1 and user_id is null),
          cats as (select id, substring(name from 7)::int as k from group_categories where group_id = $1),
          linked as (
            select id, row_number() over (order by id) as ln from movements m
             where owner_id = $2 and type = 'expense'
               and category_id in (select id from categories where owner_id = $2
                                    and name in ('Spend 2', 'Spend 4'))
             limit 500
          )
     insert into group_expenses (id, group_id, payer_member_id, created_by_member_id, amount, currency,
                                 occurred_at, category_id, description, split_mode, payer_movement_id)
     select ${uuidOf("$1::uuid::text || ':expense:' || g")}, $1,
            case when g % 2 = 0 then (select id from me) else (select id from ghost) end,
            (select id from me), (g % 500 + 2) * 100, 'ARS',
            (date_trunc('month', timezone($3, now())) - make_interval(months => (g % 2)::int)
             + make_interval(days => (g % 28)::int, secs => (g % 3600)::int)) at time zone $3,
            cats.id, 'Dinner', 'exact', linked.id
       from generate_series(1, $4::int) as g
       join cats on cats.k = (g % 5) + 1
       left join linked on linked.ln = g / 2 and g % 2 = 0 and g <= 1000`,
    [groupId, userId, TIME_ZONE, GROUP_EXPENSES],
  );
  // The user's share is half the expense, the ghost's is the rest.
  await pool.query(
    `insert into group_expense_shares (expense_id, member_id, group_id, amount)
     select e.id, gm.id, $1,
            case when gm.user_id is not null then e.amount / 2 else e.amount - e.amount / 2 end
       from group_expenses e join group_members gm on gm.group_id = e.group_id
      where e.group_id = $1`,
    [groupId],
  );
  await pool.query('analyze group_expenses');
  await pool.query('analyze group_expense_shares');
  await pool.query('analyze group_categories');
  await pool.query('analyze group_members');
}

interface Control {
  spent: bigint;
  available: bigint;
  remaining: bigint;
}

/**
 * What budget `n` (an ARS budget over 'Spend n') must report this month, from SQL with integer
 * arithmetic only: personal expenses (USD ones converted once per currency group at the seeded
 * rate, half up) minus the payer movements of group expenses, plus the user's group shares.
 */
async function controlOf(userId: string, n: number): Promise<Control> {
  const result = await pool.query<{ bucket: string; spent: string }>(
    `with start as (select date_trunc('month', timezone($2, now())) as cur),
          bounds as (select cur at time zone $2 as cur_from,
                            (cur + interval '1 month') at time zone $2 as cur_to,
                            (cur - interval '1 month') at time zone $2 as prev_from from start),
          personal as (
            select case when m.occurred_at >= b.cur_from then 'current' else 'previous' end as bucket,
                   a.currency, sum(m.amount) as total
              from movements m
              join accounts a on a.id = m.account_id and a.owner_id = m.owner_id
              join categories c on c.id = m.category_id and c.name = 'Spend ' || $3::int
              cross join bounds b
             where m.owner_id = $1 and m.type = 'expense'
               and m.occurred_at >= b.prev_from and m.occurred_at < b.cur_to
               and not exists (select 1 from group_expenses e where e.payer_movement_id = m.id)
             group by 1, 2
          ), shares as (
            select case when e.occurred_at >= b.cur_from then 'current' else 'previous' end as bucket,
                   'ARS' as currency, sum(s.amount) as total
              from group_members gm
              join group_expenses e on e.group_id = gm.group_id
              join group_categories gc on gc.id = e.category_id and lower(gc.name) = 'spend ' || $3::int
              join group_expense_shares s on s.expense_id = e.id and s.member_id = gm.id
              cross join bounds b
             where gm.user_id = $1 and s.amount > 0
               and e.occurred_at >= b.prev_from and e.occurred_at < b.cur_to
             group by 1
          )
     select bucket,
            sum(case when currency = 'ARS' then total
                     else (2 * total * $4::bigint + 10000) / 20000 end)::text as spent
       from (select * from personal union all select * from shares) all_rows
      group by bucket`,
    [userId, TIME_ZONE, n, SEEDED_RATE.toString()],
  );
  const spentOf = (bucket: string) =>
    BigInt(result.rows.find((row) => row.bucket === bucket)?.spent ?? '0');
  const amount = 100000000n + BigInt(n);
  const previousAmount = 90000000n + BigInt(n);
  const rollover = n % 4 < 2;
  const leftover = rollover ? previousAmount - spentOf('previous') : 0n;
  const available = amount + (leftover > 0n ? leftover : 0n);
  return { spent: spentOf('current'), available, remaining: available - spentOf('current') };
}

describe('budget spending latency (NFR-01)', () => {
  it('keeps p95 of the list below 500 ms for 50 budgets and 100,000 movements', async () => {
    const { harness, userId, cookies } = await startApp('perf-budgets@example.com');
    datasetOwner = userId;
    // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
    await seedDataset(pool, userId);
    await seedBudgets(userId);
    await seedGroup(userId);
    for (const table of [
      'movements',
      'categories',
      'accounts',
      'budgets',
      'budget_versions',
      'budget_version_categories',
      'budget_version_thresholds',
    ]) {
      await pool.query(`analyze ${table}`);
    }

    const url = await listen(harness.app);
    const cookie = cookieHeader(cookies);

    const warmUp = await load(url, cookie, WARM_UP_REQUESTS);
    expect(Object.fromEntries(warmUp.statuses)).toEqual({ 200: WARM_UP_REQUESTS });
    const { statuses, latencies } = await load(url, cookie, REQUESTS);

    // Real spending, so an adapter answering with empty rows cannot pass.
    const list = await readSpending(url, cookie);
    expect(list.budgets).toHaveLength(BUDGETS);
    const byName = new Map(list.budgets.map((budget) => [budget.name, budget]));
    for (const n of CONTROLLED) {
      const budget: BudgetSpendingResponse | undefined = byName.get(`Budget ${n}`);
      const control = await controlOf(userId, n);
      expect(control.spent).toBeGreaterThan(0n);
      expect(budget?.currency).toBe('ARS');
      expect(budget?.spent).toBe(control.spent.toString());
      expect(budget?.available).toBe(control.available.toString());
      expect(budget?.remaining).toBe(control.remaining.toString());
    }
    for (const budget of list.budgets) {
      expect(budget.percentUsed).toBeGreaterThanOrEqual(0);
      expect(budget.percentUsed).toBeLessThanOrEqual(1000);
    }

    const p95 = percentile(latencies, 95);
    console.log(
      `[NFR-01] budget spending: ${latencies.length} requests, p95 = ${Math.round(p95 * 10) / 10} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 300_000);

  it('lists every one of 50 budgets of a user, each with its own spending', async () => {
    if (server) {
      const closing = server;
      server = undefined;
      await new Promise<void>((resolve) => {
        closing.close(() => {
          resolve();
        });
      });
    }
    const { harness, userId, cookies } = await startApp('perf-budgets-list@example.com');
    await pool.query(
      `insert into categories (owner_id, kind, name, icon, color)
       select $1, 'expense', 'Spend ' || n, 'wallet', 'blue' from generate_series(1, $2::int) as n`,
      [userId, BUDGETS],
    );
    await seedBudgetsOnly(userId);
    const url = await listen(harness.app);
    const list = await readSpending(url, cookieHeader(cookies));
    expect(list.budgets).toHaveLength(BUDGETS);
    expect(new Set(list.budgets.map((budget) => budget.budgetId)).size).toBe(BUDGETS);
    for (const budget of list.budgets) {
      expect(budget.spent).toBe('0');
      expect(budget.remaining).toBe(budget.available);
    }
  }, 120_000);
});

/** Only the budgets over the categories 'Spend n' of `seedBudgets`, with no movement at all. */
async function seedBudgetsOnly(userId: string): Promise<void> {
  await pool.query(
    `insert into budgets (id, owner_id, currency)
     select ${uuidOf("$1::uuid::text || ':budget:' || n")}, $1, 'ARS' from generate_series(1, $2::int) as n`,
    [userId, BUDGETS],
  );
  await pool.query(
    `insert into budget_versions (id, budget_id, owner_id, effective_from, name, amount)
     select ${uuidOf("$1::uuid::text || ':version:' || n")}, ${uuidOf("$1::uuid::text || ':budget:' || n")}, $1,
            date_trunc('month', timezone($3, now()))::date, 'Budget ' || n, 1000000 + n
       from generate_series(1, $2::int) as n`,
    [userId, BUDGETS, TIME_ZONE],
  );
  await pool.query(
    `insert into budget_version_categories (version_id, owner_id, category_id)
     select v.id, $1, c.id from budget_versions v
       join categories c on c.owner_id = $1 and c.name = 'Spend ' || substring(v.name from 8)
      where v.owner_id = $1`,
    [userId],
  );
}
