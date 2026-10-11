import { createServer, type Server } from 'node:http';
import { listGoalsResponseSchema, type GoalResponse } from '@pesly/shared';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGoalRoutes } from '../../src/goals';
import { createAccountMovements } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { expectedBalance, removeDataset, seedDataset } from './movements-seed';

/**
 * NFR-02 / NFR-03 benchmarks of `GET /goals`: 50 goals linked to accounts whose balances come from
 * 100,000 real movement rows (one `GROUP BY account_id` query per list request) plus unlinked goals
 * with 1,000 entries. Timing-dependent: run it with `pnpm test:perf`.
 */

const REQUESTS = 300;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_P95_MS = 500;
const LINKED_GOALS = 50;
const UNLINKED_GOALS = 5;
const ENTRIES_PER_GOAL = 1000;
const PASSWORD = 'a long enough passphrase';

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
    // Goals first: the linked-account key restricts the account delete. Entries cascade.
    for (const id of seededUsers) await pool.query('delete from goals where owner_id = $1', [id]);
    if (datasetOwner) await removeDataset(pool, datasetOwner);
    for (const id of seededUsers) {
      if (id !== datasetOwner) await pool.query('delete from users where id = $1', [id]);
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

async function startApp(userEmail: string) {
  const routes = createGoalRoutes({
    db: connection.db,
    logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
    movements: createAccountMovements(connection.db),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes],
  });
  const userId = await seedUser(connection, { email: userEmail, password: PASSWORD });
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
        requests: [{ method: 'GET', path: '/goals', headers: { cookie } }],
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

async function listGoals(url: string, cookie: string): Promise<GoalResponse[]> {
  const response = await fetch(`${url}/goals`, { headers: { cookie } });
  expect(response.status).toBe(200);
  return listGoalsResponseSchema.parse(await response.json()).goals;
}

describe('goals list latency (NFR-02, NFR-03)', () => {
  it('keeps p95 of the list below 500 ms for 50 linked goals and 100,000 movements', async () => {
    const { harness, userId, cookies } = await startApp('perf-goals-linked@example.com');
    datasetOwner = userId;
    // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
    await seedDataset(pool, userId);
    // Goal n targets 'Account n': its currency is the account's (odd USD, even ARS).
    await pool.query(
      `insert into goals (owner_id, name, target_amount, currency, linked_account_id)
       select $1, 'Linked ' || n, 100000000 + n, a.currency, a.id
         from generate_series(1, $2::int) as n
         join accounts a on a.owner_id = $1 and a.name = 'Account ' || n`,
      [userId, LINKED_GOALS],
    );
    await pool.query(
      `insert into goals (owner_id, name, target_amount, currency)
       select $1, 'Manual ' || n, 5000000, 'ARS' from generate_series(1, $2::int) as n`,
      [userId, UNLINKED_GOALS],
    );
    await pool.query(
      `insert into goal_entries (goal_id, owner_id, kind, amount)
       select g.id, $1, case when e % 4 = 0 then 'withdrawal' else 'contribution' end, 100 + e
         from goals g cross join generate_series(1, $2::int) as e
        where g.owner_id = $1 and g.linked_account_id is null`,
      [userId, ENTRIES_PER_GOAL],
    );
    await pool.query('analyze goals');
    await pool.query('analyze goal_entries');

    const url = await listen(harness.app);
    const cookie = cookieHeader(cookies);

    const warmUp = await load(url, cookie, WARM_UP_REQUESTS);
    expect(Object.fromEntries(warmUp.statuses)).toEqual({ 200: WARM_UP_REQUESTS });
    const { statuses, latencies } = await load(url, cookie, REQUESTS);

    // Real progress, so an adapter answering with an empty map cannot pass.
    const goals = await listGoals(url, cookie);
    expect(goals).toHaveLength(LINKED_GOALS + UNLINKED_GOALS);
    const byName = new Map(goals.map((goal) => [goal.name, goal]));
    for (const n of [1, 2, 25, 50]) {
      const goal = byName.get(`Linked ${n}`);
      expect(goal?.currency).toBe(n % 2 === 0 ? 'ARS' : 'USD');
      expect(goal?.progress).toBe(expectedBalance(n).toString());
    }
    let net = 0n;
    for (let e = 1; e <= ENTRIES_PER_GOAL; e += 1)
      net += e % 4 === 0 ? -BigInt(100 + e) : BigInt(100 + e);
    for (let n = 1; n <= UNLINKED_GOALS; n += 1) {
      expect(byName.get(`Manual ${n}`)?.progress).toBe(net.toString());
    }

    const p95 = percentile(latencies, 95);
    console.log(
      `[NFR-02] goals list: ${latencies.length} requests, p95 = ${Math.round(p95 * 10) / 10} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 300_000);

  it('lists and reads every goal of a user with 50 goals, one with 1,000 entries (NFR-03)', async () => {
    if (server) {
      const closing = server;
      server = undefined;
      await new Promise<void>((resolve) => {
        closing.close(() => {
          resolve();
        });
      });
    }
    const { harness, userId, cookies } = await startApp('perf-goals-entries@example.com');
    await pool.query(
      `insert into goals (owner_id, name, target_amount, currency)
       select $1, 'Goal ' || n, 1000000, 'ARS' from generate_series(1, 50) as n`,
      [userId],
    );
    await pool.query(
      `insert into goal_entries (goal_id, owner_id, kind, amount)
       select g.id, $1, 'contribution', e
         from goals g cross join generate_series(1, $2::int) as e
        where g.owner_id = $1 and g.name = 'Goal 7'`,
      [userId, ENTRIES_PER_GOAL],
    );
    const url = await listen(harness.app);
    const cookie = cookieHeader(cookies);

    const goals = await listGoals(url, cookie);
    expect(goals).toHaveLength(50);
    const total = (ENTRIES_PER_GOAL * (ENTRIES_PER_GOAL + 1)) / 2;
    for (const goal of goals) {
      expect(goal.progress).toBe(goal.name === 'Goal 7' ? String(total) : '0');
      const single = await fetch(`${url}/goals/${goal.id}`, { headers: { cookie } });
      expect(single.status).toBe(200);
      expect((await single.json()) as GoalResponse).toEqual(goal);
    }
  }, 120_000);
});
