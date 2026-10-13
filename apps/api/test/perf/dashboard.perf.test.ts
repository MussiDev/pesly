import { createServer, type Server } from 'node:http';
import { addDays, dashboardResponseSchema, todayInTimeZone } from '@pesly/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardRoutes } from '../../src/dashboard';
import {
  cryptoMarketPrices,
  holdings,
  portfolios,
} from '../../src/investments/infrastructure/db/schema';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { newBudgetWithVersions } from '../budgets/spending-fixtures';
import { startStatementCounter } from '../dashboard/statement-counter';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { writeScope } from '../movements/db-fixtures';
import { rentOf } from '../recurring/fixtures';
import { removeDataset, seedDataset, type SeededDataset } from './movements-seed';

/**
 * NFR-01, NFR-05 and NFR-06 benchmark of `GET /dashboard` (09b, AC-50, AC-54, AC-55): 100,000
 * movements re-dated over 24 months, 40 top-level categories with spending, 50 budgets, 500
 * holdings (crypto among them), 10 groups with expenses, 2 cards with installments and stored
 * statements, recurring payments and stored rates. Timing dependent: run it with `pnpm test:perf`.
 */

const RUNS = 20;
const WARM_UP_RUNS = 2;
const MAX_P95_MS = 1000;
// 40 from DISC-001-09b NFR-05, plus 4 for the available money and 2 for the budgets' card spending
// (FEAT-011 NFR-07, AC-28).
const MAX_STATEMENTS = 46;
const MAX_BODY_BYTES = 32 * 1024;
const CATEGORIES = 40;
const BUDGETS = 50;
const PORTFOLIOS = 10;
const HOLDINGS_PER_PORTFOLIO = 50;
const CRYPTO_EVERY = 5;
const GROUPS = 10;
const GROUP_EXPENSES = 200;
const PURCHASES = 60;
const INSTALLMENTS_PER_PURCHASE = 12;
const RECURRING_PAYMENTS = 30;
const RATES = 50;
const TIME_ZONE = 'America/Cordoba';
const PASSWORD = 'a long enough passphrase';
const SPAN_SECONDS = 720 * 86_400;

let connection: DatabaseConnection;
let pool: pg.Pool;
let server: Server | undefined;
let ownerId: string | undefined;
const groupIds: string[] = [];
let cryptoSymbols: string[] = [];

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
      await pool.query(
        'delete from recurring_occurrences where payment_id in (select id from recurring_payments where owner_id = $1)',
        [ownerId],
      );
      await pool.query('delete from recurring_payments where owner_id = $1', [ownerId]);
      await pool.query('delete from budgets where owner_id = $1', [ownerId]);
      await pool.query('delete from installment_purchases where owner_id = $1', [ownerId]);
      await pool.query('delete from credit_cards where owner_id = $1', [ownerId]);
      await pool.query('delete from portfolios where owner_id = $1', [ownerId]);
    }
    for (const id of groupIds) {
      await pool.query('delete from group_expense_shares where group_id = $1', [id]);
      await pool.query('delete from group_expenses where group_id = $1', [id]);
      await pool.query('delete from groups where id = $1', [id]);
    }
    if (cryptoSymbols.length > 0) {
      await pool.query('delete from crypto_market_prices where symbol = any($1::text[])', [
        cryptoSymbols,
      ]);
    }
    await pool.query("delete from exchange_rate_history where rate_type = 'mep'");
    await pool.query("delete from exchange_rates where rate_type = 'mep'");
    if (ownerId) {
      await pool.query('delete from categories where owner_id = $1 and parent_id is not null', [
        ownerId,
      ]);
      await removeDataset(pool, ownerId);
    }
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
async function timed(url: string, cookie: string): Promise<{ ms: number; text: string }> {
  const started = performance.now();
  const response = await fetch(url, { headers: { cookie } });
  const text = await response.text();
  const ms = performance.now() - started;
  if (response.status !== 200) throw new Error(`${response.status} ${text}`);
  return { ms, text };
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

/** 40 top-level expense categories that share the expenses of the seed, and one budget over each. */
async function seedCategoriesAndBudgets(userId: string): Promise<void> {
  await pool.query(
    `insert into categories (owner_id, kind, name, icon, color)
     select $1, 'expense', 'Perf spending ' || n, 'wallet', 'blue' from generate_series(1, $2::int) as n`,
    [userId, CATEGORIES],
  );
  await pool.query(
    `with cats as (
       select id, row_number() over (order by name) - 1 as k
         from categories where owner_id = $1 and name like 'Perf spending %'
     ), ranked as (
       select id, row_number() over (order by id) as rn
         from movements where owner_id = $1 and type = 'expense'
     )
     update movements m set category_id = cats.id
       from ranked r join cats on cats.k = r.rn % $2::int
      where m.id = r.id`,
    [userId, CATEGORIES],
  );
  const cats = await pool.query<{ id: string }>(
    "select id from categories where owner_id = $1 and name like 'Perf spending %' order by name",
    [userId],
  );
  for (let b = 0; b < BUDGETS; b += 1) {
    const category = cats.rows[b % CATEGORIES]?.id;
    if (!category) throw new Error('The seed has no category for the budget');
    await newBudgetWithVersions(pool, {
      ownerId: userId,
      versions: [
        {
          effectiveFrom: '2025-01-01',
          name: `Budget ${b}`,
          amount: BigInt(10_000_000 + b * 1_000_000),
          rollover: b % 2 === 0,
          categoryIds: [category],
        },
      ],
    });
  }
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

async function seedGroups(userId: string, categoryName: string): Promise<void> {
  for (let g = 0; g < GROUPS; g += 1) {
    const group = await pool.query<{ id: string }>(
      "insert into groups (name, default_rate_type) values ($1, 'blue') returning id",
      [`Perf group ${g}`],
    );
    const id = group.rows[0]?.id;
    if (!id) throw new Error('The group insert returned no row');
    groupIds.push(id);
    await pool.query('insert into group_members (group_id, user_id) values ($1, $2)', [id, userId]);
    await pool.query("insert into group_members (group_id, display_name) values ($1, 'Ghost')", [
      id,
    ]);
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
              case when e % 2 = 0 then (select id from me) else (select id from ghost) end,
              (select id from me), (e % 500 + 2) * 100, case when e % 5 = 0 then 'USD' else 'ARS' end,
              now() - make_interval(days => (e % 90)::int, secs => (e % 3600)::int),
              cats.id, 'Dinner', 'exact'
         from generate_series(1, $3::int) as e
         join cats on cats.k = (e % 2) + 1`,
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
}

/** Two cards, each with its own two accounts, installment purchases and stored statements. */
async function seedCards(userId: string, categoryId: string): Promise<void> {
  const accounts = await pool.query<{ id: string; currency: string; name: string }>(
    `select id, currency, name from accounts
      where owner_id = $1 and name in ('Account 1', 'Account 2', 'Account 3', 'Account 4')
      order by name`,
    [userId],
  );
  const byName = new Map(accounts.rows.map((row) => [row.name, row.id]));
  const pairs: [string, string][] = [
    ['Account 2', 'Account 1'],
    ['Account 4', 'Account 3'],
  ];
  for (const [index, [arsName, usdName]] of pairs.entries()) {
    const ars = byName.get(arsName);
    const usd = byName.get(usdName);
    if (!ars || !usd) throw new Error('The seed has no ARS and USD cash account for the card');
    const card = await pool.query<{ id: string }>(
      `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
       values ($1, $2, 20, 5, $3, $4) returning id`,
      [userId, `Perf Visa ${index}`, ars, usd],
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
              ip.total_amount / $3::int
         from (select id, total_amount, row_number() over (order by id) as rn
                 from installment_purchases where owner_id = $1 and card_id = $2) ip
        cross join generate_series(1, $3::int) as n`,
      [userId, cardId, INSTALLMENTS_PER_PURCHASE],
    );
    // Stored statements: one closed and due in two days, owing, one closed long ago, one open.
    await pool.query(
      `insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date)
       select $1, $2, to_char(current_date - make_interval(months => m), 'YYYY-MM'),
              (current_date - make_interval(months => m))::date - 5,
              case when m = 1 then current_date + 2
                   else (current_date - make_interval(months => m))::date + 20 end
         from generate_series(0, 3) as m`,
      [cardId, userId],
    );
  }
}

async function seedHoldings(userId: string): Promise<void> {
  const pricedAt = new Date();
  cryptoSymbols = Array.from(
    { length: HOLDINGS_PER_PORTFOLIO / CRYPTO_EVERY },
    (_, i) => `c${i * CRYPTO_EVERY}`,
  );
  await connection.db
    .insert(cryptoMarketPrices)
    .values(cryptoSymbols.map((symbol) => ({ symbol, unitPrice: 6_400_000n, pricedAt })));
  for (let p = 0; p < PORTFOLIOS; p += 1) {
    const [portfolio] = await connection.db
      .insert(portfolios)
      .values({ ownerId: userId, name: `Portfolio ${p}` })
      .returning({ id: portfolios.id });
    if (!portfolio) throw new Error('portfolio not inserted');
    await connection.db.insert(holdings).values(
      Array.from({ length: HOLDINGS_PER_PORTFOLIO }, (_, h) => {
        const priced = h % 2 === 0;
        const crypto = h % CRYPTO_EVERY === 0;
        return {
          portfolioId: portfolio.id,
          ownerId: userId,
          ticker: crypto ? `C${h}` : `T${h}`,
          instrumentName: `Instrument ${p}-${h}`,
          instrumentType: crypto ? ('crypto' as const) : ('stock' as const),
          quantity: BigInt(h + 1) * 100_000_000n,
          valuationCurrency: crypto || h % 4 === 0 ? ('USD' as const) : ('ARS' as const),
          totalCost: 1_000_000n,
          ...(priced ? { unitPrice: 150_000n, priceSource: 'manual' as const, pricedAt } : {}),
        };
      }),
    );
  }
}

/** Weekly payments that started two weeks ago: overdue and pending occurrences, then scheduled ones. */
async function seedRecurring(userId: string, categoryId: string): Promise<void> {
  const account = await pool.query<{ id: string }>(
    "select id from accounts where owner_id = $1 and name = 'Account 2'",
    [userId],
  );
  const accountId = account.rows[0]?.id;
  if (!accountId) throw new Error('The seed has no ARS account for the payments');
  const today = todayInTimeZone(new Date(), TIME_ZONE);
  const start = addDays(today, -14);
  const repository = new DrizzleRecurringPaymentRepository(connection.db);
  const scope = await writeScope(userId);
  for (let i = 0; i < RECURRING_PAYMENTS; i += 1) {
    await repository.create(
      scope,
      rentOf(
        { ownerId: userId, accountId, categoryId },
        {
          name: `Payment ${i}`,
          frequency: 'weekly',
          weekday: i % 7,
          dayOfMonth: null,
          startDate: start,
          scheduleFrom: start,
          autoRecordingFrom: start,
        },
      ),
    );
  }
}

describe('dashboard latency (NFR-01, NFR-05, NFR-06, AC-50, AC-54, AC-55)', () => {
  it('answers under 1 s at p95 with 46 statements or fewer and a body of 32 KB or less', async () => {
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createDashboardRoutes({
          db: connection.db,
          logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
        }),
      ],
    });
    const email = 'perf-dashboard@example.com';
    const userId = await seedUser(connection, { email, password: PASSWORD, timeZone: TIME_ZONE });
    ownerId = userId;
    const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
    const dataset: SeededDataset = await seedDataset(pool, userId);
    await redate(userId);
    await seedRates();
    await seedCategoriesAndBudgets(userId);
    const category = await pool.query<{ name: string }>(
      'select name from categories where id = $1',
      [dataset.expenseCategoryId],
    );
    await seedGroups(userId, category.rows[0]?.name ?? '');
    await seedCards(userId, dataset.expenseCategoryId);
    await seedHoldings(userId);
    await seedRecurring(userId, dataset.expenseCategoryId);
    for (const table of [
      'movements',
      'categories',
      'budget_versions',
      'budget_version_categories',
      'group_expenses',
      'group_expense_shares',
      'installments',
      'installment_purchases',
      'credit_card_statements',
      'holdings',
      'recurring_payments',
      'recurring_occurrences',
    ]) {
      await pool.query(`analyze ${table}`);
    }

    const url = `${await listen(harness.app)}/dashboard`;
    const cookie = cookieHeader(cookies);
    for (let run = 0; run < WARM_UP_RUNS; run += 1) await timed(url, cookie);

    const latencies: number[] = [];
    let last = '';
    for (let run = 0; run < RUNS; run += 1) {
      const result = await timed(url, cookie);
      latencies.push(result.ms);
      last = result.text;
    }

    // One more request with every statement of the whole request counted, session lookup included.
    const counter = startStatementCounter();
    let counted: string;
    try {
      counted = (await timed(url, cookie)).text;
    } finally {
      counter.stop();
    }

    // Real figures in every section, so a section answering empty cannot pass.
    const body = dashboardResponseSchema.parse(JSON.parse(last));
    expect(BigInt(body.netWorth.ars)).not.toBe(0n);
    expect(body.netWorth.holdingsWithoutPrice).toBeGreaterThan(0);
    expect(BigInt(body.month.expenses)).toBeGreaterThan(0n);
    expect(BigInt(body.month.income)).toBeGreaterThan(0n);
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.insight).not.toBeNull();
    expect(body.budgets).toHaveLength(3);
    expect(body.actions.length).toBeGreaterThan(0);
    expect(body.upcoming.length).toBeGreaterThan(0);
    const groupAmounts = [
      body.groups.owedToYou.ars,
      body.groups.owedToYou.usd,
      body.groups.youOwe.ars,
      body.groups.youOwe.usd,
    ];
    expect(
      groupAmounts.reduce((sum, amount) => sum + BigInt(amount), 0n),
      JSON.stringify(body.groups),
    ).toBeGreaterThan(0n);

    const p95 = percentile(latencies, 95);
    const bytes = Buffer.byteLength(counted, 'utf8');
    const summary = `p95 = ${Math.trunc(p95 * 10) / 10} ms (limit ${MAX_P95_MS} ms), statements = ${counter.count} (limit ${MAX_STATEMENTS}), body = ${bytes} bytes (limit ${MAX_BODY_BYTES})`;
    console.log(`[09b NFR-01/05/06] dashboard over 100,000 movements, ${RUNS} runs: ${summary}`);
    expect(p95, summary).toBeLessThan(MAX_P95_MS);
    expect(counter.count, summary).toBeLessThanOrEqual(MAX_STATEMENTS);
    expect(bytes, summary).toBeLessThanOrEqual(MAX_BODY_BYTES);
  }, 600_000);
});
