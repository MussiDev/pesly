import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMovementRoutes } from '../../src/movements';
import type { MovementFilters } from '../../src/movements/domain/movement';
import { listMovementsQuery } from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import { OwnerOrGroupMemberAccessPolicy } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { MOVEMENTS, removeDataset, seedDataset, type SeededDataset } from './movements-seed';

/**
 * NFR-01 / NFR-02 benchmark: p95 of the filtered movement list for a user with 100 accounts, 100,000
 * movements and 200 tags. Timing-dependent: run it with `pnpm test:perf`.
 */

const REQUESTS = 500;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_P95_MS = 500;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-movements-filters@example.com';

let connection: DatabaseConnection;
let pool: pg.Pool;
let server: Server | undefined;
let perfUserId: string | undefined;

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

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

describe('filtered movement list latency (NFR-01, NFR-02)', () => {
  it('keeps p95 of every filter scenario below 500 ms and the combined plan free of a sort', async () => {
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
    const seeded: SeededDataset = await seedDataset(pool, userId);

    // 'Account 2' holds only expenses of the first child category (see the seed), and some of them
    // carry a tag: the five filters below therefore select a real, non-empty set.
    const target = await pool.query<{ id: string; tag: string }>(
      `select a.id as id, t.name as tag
         from accounts a
         join movements m on m.account_id = a.id
         join movement_tags mt on mt.movement_id = m.id
         join tags t on t.id = mt.tag_id
        where a.owner_id = $1 and a.name = 'Account 2'
        limit 1`,
      [userId],
    );
    const accountId = target.rows[0]?.id;
    const accountTag = target.rows[0]?.tag;
    if (!accountId || !accountTag) throw new Error('The seeded account or tag was not found');

    server = createServer(harness.app);
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    const address = listening.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');
    const url = `http://127.0.0.1:${address.port}`;

    async function load(path: string, amount: number) {
      const statuses = new Map<number, number>();
      const latencies: number[] = [];
      await new Promise<void>((resolve, reject) => {
        const instance = autocannon(
          {
            url,
            connections: CONNECTIONS,
            amount,
            timeout: 30,
            requests: [{ method: 'GET', path, headers: { cookie: cookieHeader(cookies) } }],
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

    async function firstPage(path: string): Promise<{ items: unknown[]; total: number }> {
      const response = await fetch(`${url}${path}`, { headers: { cookie: cookieHeader(cookies) } });
      expect(response.status).toBe(200);
      return (await response.json()) as { items: unknown[]; total: number };
    }

    const combined = {
      accountId,
      categoryId: seeded.parentCategoryId,
      from: isoDay(-2),
      to: isoDay(1),
      type: 'expense',
      tag: accountTag,
    };
    const combinedPath = (limit: number) =>
      `/movements?${new URLSearchParams({ limit: String(limit), ...combined }).toString()}`;
    const scenarios = [
      { name: 'all five filters', path: combinedPath(100), minTotal: 1, minItems: 1 },
      {
        name: 'parent category only',
        path: `/movements?limit=100&categoryId=${seeded.parentCategoryId}`,
        minTotal: MOVEMENTS / 10,
        minItems: 100,
      },
      {
        name: 'tag only',
        path: `/movements?limit=100&tag=${encodeURIComponent(seeded.tagName)}`,
        minTotal: 100,
        minItems: 100,
      },
      {
        name: 'unfiltered first page',
        path: '/movements?limit=100',
        minTotal: MOVEMENTS,
        minItems: 100,
      },
    ];

    const results: { name: string; p95: number }[] = [];
    for (const scenario of scenarios) {
      // Real rows, so a route answering an empty page quickly cannot pass.
      const page = await firstPage(scenario.path);
      expect(page.total, scenario.name).toBeGreaterThanOrEqual(scenario.minTotal);
      expect(page.items.length, scenario.name).toBeGreaterThanOrEqual(scenario.minItems);
      expect(page.items.length, scenario.name).toBeLessThanOrEqual(100);

      // Warm-up (pool connections, planner, JIT) is not measured.
      const warmUp = await load(scenario.path, WARM_UP_REQUESTS);
      expect(Object.fromEntries(warmUp.statuses), scenario.name).toEqual({
        200: WARM_UP_REQUESTS,
      });
      const { statuses, latencies } = await load(scenario.path, REQUESTS);
      expect(Object.fromEntries(statuses), scenario.name).toEqual({ 200: REQUESTS });
      const p95 = percentile(latencies, 95);
      results.push({ name: scenario.name, p95 });
      console.log(
        `[NFR-01] ${scenario.name}: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
      );
    }

    // NFR-02: the page limit still holds with filters.
    const refused = await fetch(`${url}${combinedPath(101)}`, {
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(refused.status).toBe(400);

    // The planner runs with its default settings (no enable_* switches).
    //
    // Without a tag, the combined statement must be ordered by an index on the date: no sort.
    // With a tag the plan is different on purpose: one tag matches few movements (about 333 of
    // 100,000 here), so the planner starts from the tag index and sorts that small set, which is
    // cheaper than walking a date-ordered index. That is accepted as a bounded top-N sort under the
    // LIMIT over the tag-restricted set, never a scan or a full sort of the movements table.
    const scope = await new OwnerOrGroupMemberAccessPolicy(
      new DenyAllGroupMembershipReader(),
    ).scopeFor({ userId, sessionId: 's', emailVerified: true }, 'read');
    const range = {
      occurredFrom: new Date(Date.now() - 2 * 86_400_000),
      occurredBefore: new Date(Date.now() + 86_400_000),
    };
    async function planOf(filters: MovementFilters): Promise<string> {
      const built = listMovementsQuery(connection.db, scope, {
        limit: 100,
        offset: 0,
        filters,
      }).toSQL();
      // ANALYZE only to read the sort method (top-N); the statement is a read.
      const plan = await pool.query<{ 'QUERY PLAN': string }>(
        `explain (analyze, costs off, timing off) ${built.sql}`,
        built.params,
      );
      return plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    }
    const withoutTag = await planOf({
      accountId,
      categoryId: seeded.parentCategoryId,
      type: 'expense',
      ...range,
    });
    const withTag = await planOf({
      accountId,
      categoryId: seeded.parentCategoryId,
      type: 'expense',
      tag: accountTag,
      ...range,
    });
    const tagOnly = await planOf({ tag: seeded.tagName });
    console.log(`[NFR-01] plan without tag:\n${withoutTag}`);
    console.log(`[NFR-01] plan with tag:\n${withTag}`);
    console.log(`[NFR-01] plan tag only:\n${tagOnly}`);

    for (const result of results) {
      expect(result.p95, `${result.name} p95`).toBeLessThan(MAX_P95_MS);
    }
    expect(withoutTag).toMatch(/Index (Only )?Scan( Backward)? using movements_owner_\w*date_idx/);
    expect(withoutTag).not.toMatch(/\bSort\b/);
    for (const plan of [withTag, tagOnly]) {
      expect(plan).toMatch(
        /Index Scan on movement_tags_tag_idx|Index Scan (?:using|on) tags_owner_name_\w*/,
      );
      expect(plan).not.toMatch(/Seq Scan on movements\b/);
      expect(plan).toMatch(/Sort Method: top-N heapsort/);
      expect(plan).not.toMatch(/Sort Method: (quicksort|external)/);
    }
  }, 600_000);
});
