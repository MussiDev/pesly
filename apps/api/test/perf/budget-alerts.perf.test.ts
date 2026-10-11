import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBudgetAlertListener } from '../../src/budgets';
import {
  BestEffortExpenseSavedHook,
  createMovementRoutes,
  type ExpenseSavedFailure,
} from '../../src/movements';
import { renderBudgetAlertText } from '../../src/notices';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { removeDataset, seedDataset } from './movements-seed';

/**
 * NFR-02 benchmark of the budget alert evaluation (06d): the time it adds to `POST /movements`
 * for 50 budgets that all cover the category of the expense, 100,000 real movements, half of the
 * budgets with rollover on. The same request is measured with the evaluation off and on, and
 * the difference at p95 is the added time. Timing dependent: run it with `pnpm test:perf`.
 */

const REQUESTS = 300;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_ADDED_P95_MS = 100;
const BUDGETS = 50;
const TIME_ZONE = 'America/Cordoba';
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-budget-alerts@example.com';
const RAISED_WRITE_LIMIT = 100_000;
/** Each of the 640 expenses adds a thousandth of what the category already holds this month. */
const SHARE_DIVISOR = 1000n;

let connection: DatabaseConnection;
let pool: pg.Pool;
const servers: Server[] = [];
let ownerId: string | undefined;

beforeAll(() => {
  assertIsTestDatabase(testDatabaseUrl);
  connection = createDatabase(testDatabaseUrl);
  pool = new pg.Pool({ connectionString: testDatabaseUrl, max: CONNECTIONS });
});

afterAll(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  try {
    assertIsTestDatabase(testDatabaseUrl);
    if (ownerId) {
      // Budgets first: their category keys restrict the category delete.
      await pool.query('delete from budgets where owner_id = $1', [ownerId]);
      await removeDataset(pool, ownerId);
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

async function listen(app: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('server not listening');
  return `http://127.0.0.1:${address.port}`;
}

async function load(url: string, cookie: string, body: string, amount: number) {
  const statuses = new Map<number, number>();
  const latencies: number[] = [];
  await new Promise<void>((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: CONNECTIONS,
        amount,
        timeout: 30,
        requests: [
          {
            method: 'POST',
            path: '/movements',
            headers: { ...trustedHeaders, 'content-type': 'application/json', cookie },
            body,
          },
        ],
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

/** What the category holds this month, in the user's zone, from SQL (integer minor units). */
async function currentSpending(userId: string, categoryId: string): Promise<bigint> {
  const result = await pool.query<{ spent: string }>(
    `select coalesce(sum(amount), 0)::text as spent from movements
      where owner_id = $1 and type = 'expense' and category_id = $2
        and occurred_at >= date_trunc('month', timezone($3, now())) at time zone $3`,
    [userId, categoryId, TIME_ZONE],
  );
  return BigInt(result.rows[0]?.spent ?? '0');
}

/**
 * 50 budgets over the expense category of the seed, with a version this month and one last
 * month, thresholds 80 and 100, rollover on for half of them. Budget n is sized so that it
 * starts at `30 + 2n` percent of what the category holds now, which leaves a mix of budgets
 * that cross during the run and budgets that never do.
 */
async function seedBudgets(userId: string, categoryId: string, current: bigint): Promise<void> {
  await pool.query(
    `insert into budgets (id, owner_id, currency)
     select ${uuidOf("$1::uuid::text || ':budget:' || n")}, $1, 'ARS' from generate_series(1, $2::int) as n`,
    [userId, BUDGETS],
  );
  await pool.query(
    `insert into budget_versions (id, budget_id, owner_id, effective_from, name, amount, rollover)
     select ${uuidOf("$1::uuid::text || ':version:' || n || ':' || m")}, ${uuidOf("$1::uuid::text || ':budget:' || n")},
            $1,
            (date_trunc('month', timezone($3, now())) - make_interval(months => m))::date,
            'Budget ' || n,
            greatest(1, ($4::bigint * 100) / (30 + 2 * n)),
            n % 2 = 0
       from generate_series(1, $2::int) as n cross join generate_series(0, 1) as m`,
    [userId, BUDGETS, TIME_ZONE, current.toString()],
  );
  await pool.query(
    `insert into budget_version_categories (version_id, owner_id, category_id)
     select id, $1, $2 from budget_versions where owner_id = $1`,
    [userId, categoryId],
  );
  await pool.query(
    `insert into budget_version_thresholds (version_id, owner_id, percent)
     select id, $1, p from budget_versions cross join (values (80), (100)) as t(p)
      where owner_id = $1`,
    [userId],
  );
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
}

/**
 * How many (budget, threshold) pairs the final state must have crossed, from SQL with integer
 * arithmetic only: the spending of the category this month against each budget's amount plus
 * the leftover of last month when rollover is on, percent rounded down.
 */
async function expectedNotices(userId: string, categoryId: string): Promise<number> {
  const result = await pool.query<{ expected: string; crossed_budgets: string }>(
    `with start as (select date_trunc('month', timezone($2, now())) as cur),
          bounds as (select cur at time zone $2 as cur_from,
                            (cur - interval '1 month') at time zone $2 as prev_from,
                            (cur + interval '1 month') at time zone $2 as cur_to,
                            cur::date as cur_day,
                            (cur - interval '1 month')::date as prev_day from start),
          spent as (
            select coalesce(sum(m.amount) filter (where m.occurred_at >= b.cur_from), 0) as cur,
                   coalesce(sum(m.amount) filter (where m.occurred_at < b.cur_from), 0) as prev
              from movements m cross join bounds b
             where m.owner_id = $1 and m.type = 'expense' and m.category_id = $3
               and m.occurred_at >= b.prev_from and m.occurred_at < b.cur_to
          ), pct as (
            select div(s.cur * 100, v.amount
                       + case when v.rollover then greatest(0, p.amount - s.prev) else 0 end) as percent
              from budget_versions v
              join bounds b on v.effective_from = b.cur_day
              join budget_versions p on p.budget_id = v.budget_id and p.effective_from = b.prev_day
              cross join spent s
             where v.owner_id = $1
          )
     select (sum((percent >= 80)::int + (percent >= 100)::int))::text as expected,
            (count(*) filter (where percent >= 80))::text as crossed_budgets
       from pct`,
    [userId, TIME_ZONE, categoryId],
  );
  return Number(result.rows[0]?.expected);
}

async function budgetAlertNotices(userId: string): Promise<number> {
  const result = await pool.query<{ n: string }>(
    "select count(*) as n from notices where owner_id = $1 and kind = 'budget_alert'",
    [userId],
  );
  return Number(result.rows[0]?.n);
}

describe('budget alert evaluation latency (NFR-02)', () => {
  it('adds under 100 ms at p95 to POST /movements for 50 budgets over one category and 100,000 movements', async () => {
    const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
    const failures: ExpenseSavedFailure[] = [];
    const hook = new BestEffortExpenseSavedHook(
      createBudgetAlertListener(connection.db, { renderText: renderBudgetAlertText }),
      (failure) => {
        failures.push(failure);
      },
    );
    const harnessOff = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createMovementRoutes({ db: connection.db, logger, writeLimit: RAISED_WRITE_LIMIT }),
      ],
    });
    const harnessOn = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createMovementRoutes({
          db: connection.db,
          logger,
          writeLimit: RAISED_WRITE_LIMIT,
          expenseSaved: hook,
        }),
      ],
    });
    const userId = await seedUser(connection, {
      email: EMAIL,
      password: PASSWORD,
      timeZone: TIME_ZONE,
    });
    ownerId = userId;
    const cookie = cookieHeader(sessionFrom(await signIn(harnessOff.app, EMAIL, PASSWORD)));

    // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
    const { expenseCategoryId } = await seedDataset(pool, userId);
    const account = await pool.query<{ id: string; currency: string }>(
      "select id, currency from accounts where owner_id = $1 and name = 'Account 2'",
      [userId],
    );
    const accountId = account.rows[0]?.id;
    if (!accountId || account.rows[0]?.currency !== 'ARS') throw new Error('Account 2 must be ARS');
    const initial = await currentSpending(userId, expenseCategoryId);
    expect(initial).toBeGreaterThan(0n);
    await seedBudgets(userId, expenseCategoryId, initial);

    const body = JSON.stringify({
      type: 'expense',
      accountId,
      categoryId: expenseCategoryId,
      amount: (initial / SHARE_DIVISOR).toString(),
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      rate: { source: 'manual', value: '14000000' },
    });
    const urlOff = await listen(harnessOff.app);
    const urlOn = await listen(harnessOn.app);

    const measure = async (url: string) => {
      const warmUp = await load(url, cookie, body, WARM_UP_REQUESTS);
      expect(Object.fromEntries(warmUp.statuses)).toEqual({ 201: WARM_UP_REQUESTS });
      return load(url, cookie, body, REQUESTS);
    };
    const off = await measure(urlOff);
    // The control: with the evaluation off nothing is published, so an `on` run that publishes
    // is not publishing because of the seed.
    expect(await budgetAlertNotices(userId)).toBe(0);
    const on = await measure(urlOn);

    const expected = await expectedNotices(userId, expenseCategoryId);
    const published = await budgetAlertNotices(userId);
    const marks = await pool.query<{ n: string }>(
      'select count(*) as n from budget_alert_marks where owner_id = $1',
      [userId],
    );
    const stored = await pool.query<{ n: string }>(
      "select count(*) as n from movements where owner_id = $1 and category_id = $2 and type = 'expense' and amount = $3",
      [userId, expenseCategoryId, (initial / SHARE_DIVISOR).toString()],
    );

    const p95Off = percentile(off.latencies, 95);
    const p95On = percentile(on.latencies, 95);
    const added = p95On - p95Off;
    console.log(
      `[NFR-02] budget alerts: ${on.latencies.length} requests, p95 off = ${Math.round(p95Off * 10) / 10} ms, ` +
        `p95 on = ${Math.round(p95On * 10) / 10} ms, added = ${Math.round(added * 10) / 10} ms ` +
        `(limit ${MAX_ADDED_P95_MS} ms), notices = ${published} (SQL control ${expected})`,
    );

    expect(Object.fromEntries(off.statuses)).toEqual({ 201: REQUESTS });
    expect(Object.fromEntries(on.statuses)).toEqual({ 201: REQUESTS });
    expect(stored.rows[0]?.n).toBe(String(2 * (WARM_UP_REQUESTS + REQUESTS)));
    expect(failures).toEqual([]);
    // Neither none nor all: the sizing left budgets on both sides of each threshold.
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(2 * BUDGETS);
    expect(published).toBe(expected);
    expect(marks.rows[0]?.n).toBe(String(expected));
    expect(added).toBeLessThan(MAX_ADDED_P95_MS);
  }, 600_000);
});
