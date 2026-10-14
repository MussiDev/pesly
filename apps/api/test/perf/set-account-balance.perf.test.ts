import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createAccountMovements, createBalanceAdjuster } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { removeDataset } from './movements-seed';

/**
 * NFR-01 benchmark of FEAT-012 (AC-17): p95 of `POST /accounts/:id/balance` for an account with
 * 10,000 movements. Each request locks the account row, sums the account's movements and inserts
 * one adjustment; none calls an external service. Timing-dependent: run it with `pnpm test:perf`,
 * ideally one perf file at a time.
 */

const MOVEMENTS = 10_000;
const REQUESTS = 300;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 4;
const MAX_P95_MS = 500;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-set-account-balance@example.com';

let connection: DatabaseConnection;
let pool: pg.Pool;
let server: Server | undefined;
let perfUserId: string | undefined;

beforeAll(() => {
  assertIsTestDatabase(testDatabaseUrl);
  connection = createDatabase(testDatabaseUrl);
  pool = new pg.Pool({ connectionString: testDatabaseUrl, max: CONNECTIONS });
});

afterEach(async () => {
  if (server) {
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve) => {
      closing.close(() => {
        resolve();
      });
    });
  }
});

afterAll(async () => {
  try {
    assertIsTestDatabase(testDatabaseUrl);
    if (perfUserId) await removeDataset(pool, perfUserId);
  } finally {
    await pool.end();
    await connection.pool.end();
  }
});

/** The 95th percentile; with no value at all it is infinite, so an empty run can never pass. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

interface Prepared {
  url: string;
  cookies: SessionCookies;
  accountId: string;
}

async function prepare(): Promise<Prepared> {
  const routes = createAccountRoutes({
    db: connection.db,
    logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
    movements: createAccountMovements(connection.db),
    balanceAdjuster: createBalanceAdjuster(connection.db),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes],
  });
  const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
  perfUserId = userId;
  const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));

  // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
  const account = await pool.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
     values ($1, 'Perf account', 'cash', 'ARS', 0, true) returning id`,
    [userId],
  );
  const accountId = account.rows[0]?.id;
  if (!accountId) throw new Error('The perf account was not inserted');
  const categories = await pool.query<{ kind: string; id: string }>(
    `insert into categories (owner_id, kind, name, icon, color)
     values ($1, 'expense', 'Perf expense', 'utensils', 'red'),
            ($1, 'income', 'Perf income', 'utensils', 'green') returning kind, id`,
    [userId],
  );
  const expenseId = categories.rows.find((row) => row.kind === 'expense')?.id;
  const incomeId = categories.rows.find((row) => row.kind === 'income')?.id;
  if (!expenseId || !incomeId) throw new Error('The perf categories were not inserted');
  await pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     select $1::uuid,
            case when g % 2 = 0 then 'income' else 'expense' end,
            $2::uuid,
            case when g % 2 = 0 then $4::uuid else $3::uuid end,
            ((g % 2000) + 1)::bigint * 100,
            now() - make_interval(secs => g),
            14000000, 'manual'
       from generate_series(1, $5::int) as g`,
    [userId, accountId, expenseId, incomeId, MOVEMENTS],
  );

  server = createServer(harness.app);
  const listening = server;
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  const address = listening.address();
  if (!address || typeof address !== 'object') throw new Error('server not listening');
  return { url: `http://127.0.0.1:${address.port}`, cookies, accountId };
}

async function load(prep: Prepared, amount: number, firstTarget: number) {
  const statuses = new Map<number, number>();
  const latencies: number[] = [];
  let next = firstTarget;
  await new Promise<void>((resolve, reject) => {
    const instance = autocannon(
      {
        url: prep.url,
        connections: CONNECTIONS,
        amount,
        timeout: 30,
        requests: [
          {
            method: 'POST',
            path: `/accounts/${prep.accountId}/balance`,
            headers: {
              ...trustedHeaders,
              'content-type': 'application/json',
              cookie: cookieHeader(prep.cookies),
            },
            // A different target every time, so every request really inserts an adjustment.
            setupRequest: (request) => ({
              ...request,
              body: JSON.stringify({ balance: String(1_000_000 + next++ * 37) }),
            }),
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

describe('percentile helper', () => {
  it('is infinite for an empty run and the 95th value otherwise, so a silent run cannot pass', () => {
    expect(percentile([], 95)).toBe(Number.POSITIVE_INFINITY);
    expect(
      percentile(
        Array.from({ length: 100 }, (_, index) => index + 1),
        95,
      ),
    ).toBe(95);
  });
});

describe('set account balance latency (NFR-01)', () => {
  it('keeps p95 of setting a balance on an account with 10,000 movements below 500 ms (AC-17)', async () => {
    const prep = await prepare();

    // Warm-up (pool connections, planner, JIT) is not measured.
    const warmUp = await load(prep, WARM_UP_REQUESTS, 0);
    expect(Object.fromEntries(warmUp.statuses)).toEqual({ 200: WARM_UP_REQUESTS });
    const { statuses, latencies } = await load(prep, REQUESTS, WARM_UP_REQUESTS);

    const p95 = percentile(latencies, 95);
    console.log(
      `[NFR-01] set balance: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    expect(p95).toBeLessThan(MAX_P95_MS);

    // Every request really wrote its adjustment: a route answering 200 without saving cannot pass.
    const stored = await pool.query<{ n: string }>(
      "select count(*) as n from movements where account_id = $1 and type = 'adjustment'",
      [prep.accountId],
    );
    expect(stored.rows[0]?.n).toBe(String(WARM_UP_REQUESTS + REQUESTS));
  }, 180_000);
});
