import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMovementRoutes } from '../../src/movements';
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
import { removeDataset, seedDataset } from './movements-seed';

/**
 * NFR-03 benchmark of spec 03e: p95 of `PUT /movements/:id` (one read, one transaction with the
 * update, the removal of the tag links and the new links) and of `DELETE /movements/:id` (one
 * statement), for a user who already has 100 accounts and 100,000 movements. No external call in
 * either path. Timing-dependent: run it with `pnpm test:perf`, ideally one perf file at a time.
 */

const REQUESTS = 500;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-movements-edit-delete@example.com';

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
  userId: string;
  accountId: string;
  expenseCategoryId: string;
}

async function prepare(): Promise<Prepared> {
  const routes = createMovementRoutes({
    db: connection.db,
    logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes],
  });
  const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
  perfUserId = userId;
  const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));

  // Seeding failures (including an unreachable database) fail the run: nothing here is caught.
  const { expenseCategoryId } = await seedDataset(pool, userId);
  const account = await pool.query<{ id: string }>(
    'select id from accounts where owner_id = $1 and name = $2',
    [userId, 'Account 1'],
  );
  const accountId = account.rows[0]?.id;
  if (!accountId) throw new Error('The seeded account was not found');

  server = createServer(harness.app);
  const listening = server;
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  const address = listening.address();
  if (!address || typeof address !== 'object') throw new Error('server not listening');
  return { url: `http://127.0.0.1:${address.port}`, cookies, userId, accountId, expenseCategoryId };
}

/** Inserts `count` expenses of the user in one statement and returns their ids. */
async function insertTargets(prep: Prepared, count: number): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     select $1::uuid, 'expense', $2::uuid, $3::uuid, 100, now() - interval '1 hour', 14000000, 'manual'
     from generate_series(1, $4::int) returning id`,
    [prep.userId, prep.accountId, prep.expenseCategoryId, count],
  );
  return result.rows.map((row) => row.id);
}

interface Run {
  method: 'PUT' | 'DELETE';
  /** The path of the n-th request; a function so each DELETE can target its own movement. */
  pathOf: (index: number) => string;
  body?: string;
}

async function load(prep: Prepared, run: Run, amount: number, firstIndex: number) {
  const statuses = new Map<number, number>();
  const latencies: number[] = [];
  let next = firstIndex;
  await new Promise<void>((resolve, reject) => {
    const instance = autocannon(
      {
        url: prep.url,
        connections: CONNECTIONS,
        amount,
        timeout: 30,
        requests: [
          {
            method: run.method,
            headers: {
              ...trustedHeaders,
              'content-type': 'application/json',
              cookie: cookieHeader(prep.cookies),
            },
            ...(run.body === undefined ? {} : { body: run.body }),
            setupRequest: (request) => ({ ...request, path: run.pathOf(next++) }),
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

async function measure(label: string, prep: Prepared, run: Run, expectedStatus: number) {
  // Warm-up (pool connections, planner, JIT) is not measured.
  const warmUp = await load(prep, run, WARM_UP_REQUESTS, 0);
  expect(Object.fromEntries(warmUp.statuses)).toEqual({ [expectedStatus]: WARM_UP_REQUESTS });
  const { statuses, latencies } = await load(prep, run, REQUESTS, WARM_UP_REQUESTS);

  const p95 = percentile(latencies, 95);
  console.log(
    `[NFR-03] ${label}: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
  );
  expect(Object.fromEntries(statuses)).toEqual({ [expectedStatus]: REQUESTS });
  expect(p95).toBeLessThan(MAX_P95_MS);
  return p95;
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

describe('movement edit and delete latency (NFR-03)', () => {
  it('keeps p95 of editing a movement with tags below 300 ms', async () => {
    const prep = await prepare();
    const [target] = await insertTargets(prep, 1);
    if (target === undefined) throw new Error('The target movement was not inserted');
    const body = JSON.stringify({
      type: 'expense',
      accountId: prep.accountId,
      categoryId: prep.expenseCategoryId,
      amount: '2500',
      occurredAt: new Date(Date.now() - 7_200_000).toISOString(),
      note: 'edited by the benchmark',
      tags: ['perf-a', 'perf-b', 'perf-c'],
      rate: { source: 'keep' },
    });

    await measure('edit', prep, { method: 'PUT', pathOf: () => `/movements/${target}`, body }, 200);

    // Every request really wrote the movement: a route answering 200 without saving cannot pass.
    const stored = await pool.query<{ amount: string; note: string }>(
      'select amount::text, note from movements where id = $1',
      [target],
    );
    expect(stored.rows[0]).toEqual({ amount: '2500', note: 'edited by the benchmark' });
    const links = await pool.query<{ n: string }>(
      'select count(*) as n from movement_tags where movement_id = $1',
      [target],
    );
    expect(links.rows[0]?.n).toBe('3');
  }, 180_000);

  it('keeps p95 of deleting a movement below 300 ms', async () => {
    const prep = await prepare();
    const ids = await insertTargets(prep, WARM_UP_REQUESTS + REQUESTS);

    await measure(
      'delete',
      prep,
      {
        method: 'DELETE',
        pathOf: (index) => {
          const id = ids[index];
          if (id === undefined) throw new Error(`No movement was prepared for request ${index}`);
          return `/movements/${id}`;
        },
      },
      204,
    );

    // Every request really deleted its movement.
    const left = await pool.query<{ n: string }>(
      'select count(*) as n from movements where id = any($1::uuid[])',
      [ids],
    );
    expect(left.rows[0]?.n).toBe('0');
  }, 180_000);
});
