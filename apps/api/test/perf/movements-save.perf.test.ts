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
import { MOVEMENTS, removeDataset, seedDataset } from './movements-seed';

/**
 * NFR-03 benchmark: p95 of `POST /movements` (one insert, one limiter upsert and four indexed point
 * reads, no external call) for an expense, a transfer and a currency exchange, for a user who
 * already has 100 accounts and 100,000 movements. The write limit is raised so the limiter never
 * answers 429 during the run. Timing-dependent: run it with `pnpm test:perf`, ideally one perf
 * file at a time.
 */

const REQUESTS = 500;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-movements-save@example.com';
const RAISED_WRITE_LIMIT = 100_000;

let connection: DatabaseConnection;
let pool: pg.Pool;
let server: Server | undefined;
let perfUserId: string | undefined;
let savedSoFar = 0;

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

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

interface Prepared {
  url: string;
  cookies: SessionCookies;
  expenseCategoryId: string;
  /** 'Account 1' and 'Account 3' are USD (odd), 'Account 2' is ARS (even); none is a credit card. */
  usdAccountId: string;
  otherUsdAccountId: string;
  arsAccountId: string;
}

async function accountIdNamed(userId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'select id from accounts where owner_id = $1 and name = $2',
    [userId, name],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`The seeded account ${name} was not found`);
  return id;
}

/**
 * Seeds the dataset and starts the server for one benchmark. The suite setup truncates every table
 * before each test, so each benchmark seeds its own dataset.
 */
async function prepare(): Promise<Prepared> {
  const routes = createMovementRoutes({
    db: connection.db,
    logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
    writeLimit: RAISED_WRITE_LIMIT,
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
  const usdAccountId = await accountIdNamed(userId, 'Account 1');
  const arsAccountId = await accountIdNamed(userId, 'Account 2');
  const otherUsdAccountId = await accountIdNamed(userId, 'Account 3');
  savedSoFar = MOVEMENTS;

  server = createServer(harness.app);
  const listening = server;
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  const address = listening.address();
  if (!address || typeof address !== 'object') throw new Error('server not listening');
  return {
    url: `http://127.0.0.1:${address.port}`,
    cookies,
    expenseCategoryId,
    usdAccountId,
    otherUsdAccountId,
    arsAccountId,
  };
}

async function load(prep: Prepared, body: string, amount: number) {
  const statuses = new Map<number, number>();
  const latencies: number[] = [];
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
            path: '/movements',
            headers: {
              ...trustedHeaders,
              'content-type': 'application/json',
              cookie: cookieHeader(prep.cookies),
            },
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

async function measureSave(label: string, prep: Prepared, body: object): Promise<void> {
  const payload = JSON.stringify(body);

  // Warm-up (pool connections, planner, JIT) is not measured.
  const warmUp = await load(prep, payload, WARM_UP_REQUESTS);
  expect(Object.fromEntries(warmUp.statuses)).toEqual({ 201: WARM_UP_REQUESTS });
  const { statuses, latencies } = await load(prep, payload, REQUESTS);
  savedSoFar += WARM_UP_REQUESTS + REQUESTS;

  // Every request really inserted a row, so a route answering 201 without saving cannot pass.
  const stored = await pool.query<{ n: string }>(
    'select count(*) as n from movements where owner_id = $1',
    [perfUserId],
  );
  expect(stored.rows[0]?.n).toBe(String(savedSoFar));

  const p95 = percentile(latencies, 95);
  console.log(
    `[NFR-03] ${label} save: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
  );
  expect(Object.fromEntries(statuses)).toEqual({ 201: REQUESTS });
  expect(p95).toBeLessThan(MAX_P95_MS);
}

const anHourAgo = (): string => new Date(Date.now() - 3_600_000).toISOString();

describe('movement save latency (NFR-03)', () => {
  it('keeps p95 of saving a movement below 300 ms', async () => {
    const prep = await prepare();
    await measureSave('movement', prep, {
      type: 'expense',
      accountId: prep.usdAccountId,
      categoryId: prep.expenseCategoryId,
      amount: '1500',
      occurredAt: anHourAgo(),
      rate: { source: 'manual', value: '14000000' },
    });
  }, 180_000);

  it('keeps p95 of saving a transfer below 300 ms', async () => {
    const prep = await prepare();
    await measureSave('transfer', prep, {
      type: 'transfer',
      accountId: prep.usdAccountId,
      destinationAccountId: prep.otherUsdAccountId,
      amount: '1500',
      occurredAt: anHourAgo(),
    });
  }, 180_000);

  it('keeps p95 of saving a currency exchange below 300 ms', async () => {
    const prep = await prepare();
    await measureSave('exchange', prep, {
      type: 'exchange',
      accountId: prep.arsAccountId,
      destinationAccountId: prep.usdAccountId,
      amount: '1500000',
      destinationAmount: '1000',
      occurredAt: anHourAgo(),
    });
  }, 180_000);
});
