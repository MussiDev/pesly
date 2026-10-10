import { createServer, type Server } from 'node:http';
import { listNoticesResponseSchema, type ListNoticesResponse } from '@pesly/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createNoticesRoutes } from '../../src/notices';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

/**
 * NFR-04 benchmark: p95 of `GET /notices?limit=50` for one user with 1,000 notices, through the
 * real app and sessions. Timing-dependent, so it runs with `pnpm test:perf`.
 */

const NOTICES = 1_000;
const REQUESTS = 100;
const WARM_UP_REQUESTS = 10;
const PAGE_SIZE = 50;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-notices@example.com';

let connection: DatabaseConnection;
let server: Server | undefined;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
  server = undefined;
});

afterAll(async () => {
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

describe('notices list latency (NFR-04)', () => {
  it('keeps p95 of GET /notices?limit=50 below 300 ms for a user with 1,000 notices', async () => {
    const routes = createNoticesRoutes({
      db: connection.db,
      logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
    });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [routes],
    });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));
    // Bulk seed: one second apart, every tenth already read so the unread count is not trivial.
    await connection.pool.query(
      `insert into notices (owner_id, kind, payment_id, due_date, text, created_at, read_at)
       select $1, 'reminder', gen_random_uuid(), date '2026-10-05', 'Notice ' || n,
              now() - make_interval(secs => n),
              case when n % 10 = 0 then now() else null end
       from generate_series(1, $2::int) as n`,
      [userId, NOTICES],
    );

    server = createServer(harness.app);
    const target = server;
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');
    const url = `http://127.0.0.1:${address.port}`;

    async function list(query: string): Promise<{ body: ListNoticesResponse; elapsed: number }> {
      const started = performance.now();
      const response = await fetch(`${url}/notices${query}`, {
        headers: { ...trustedHeaders, cookie: cookieHeader(cookies) },
      });
      const json: unknown = await response.json();
      const elapsed = performance.now() - started;
      expect(response.status).toBe(200);
      return { body: listNoticesResponseSchema.parse(json), elapsed };
    }

    for (let i = 0; i < WARM_UP_REQUESTS; i += 1) await list(`?limit=${PAGE_SIZE}`);

    const latencies: number[] = [];
    for (let i = 0; i < REQUESTS; i += 1) {
      const { body, elapsed } = await list(`?limit=${PAGE_SIZE}`);
      expect(body.items).toHaveLength(PAGE_SIZE);
      latencies.push(elapsed);
    }

    // A cursor page is served by the same keyset index, so it is held to the same budget.
    const first = await list(`?limit=${PAGE_SIZE}`);
    expect(first.body.nextCursor).not.toBeNull();
    expect(first.body.unreadCount).toBe(NOTICES - NOTICES / 10);
    const second = await list(`?limit=${PAGE_SIZE}&cursor=${first.body.nextCursor ?? ''}`);
    expect(second.body.items).toHaveLength(PAGE_SIZE);
    expect(second.body.items[0]?.id).not.toBe(first.body.items[0]?.id);
    expect(second.elapsed).toBeLessThan(MAX_P95_MS);

    const p95 = percentile(latencies, 95);
    console.log(
      `[08c NFR-04] notices list: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms, cursor page = ${second.elapsed.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 120_000);
});
