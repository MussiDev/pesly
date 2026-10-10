import { upcomingResponseSchema } from '@pesly/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecurringExpenseRecorder } from '../../src/movements';
import { createRecurringRoutes } from '../../src/recurring';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { newAccount, newCategory, writeScope } from '../movements/db-fixtures';
import { rentOf } from '../recurring/fixtures';

/** NFR-02: p95 of `GET /recurring/upcoming` for a user with 100 recurring payments. */
const PAYMENTS = 100;
const REQUESTS = 50;
const MAX_P95_MS = 300;

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

describe('upcoming latency (NFR-02)', () => {
  it('keeps p95 of 50 reads with 100 payments below 300 ms', async () => {
    const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createRecurringRoutes({
          db: connection.db,
          logger,
          expenses: createRecurringExpenseRecorder(connection.db, logger),
        }),
      ],
    });
    const email = 'perf-recurring@example.com';
    const password = 'a long enough passphrase';
    const ownerId = await seedUser(connection, { email, password });
    const cookies = sessionFrom(await signIn(harness.app, email, password));
    const accountId = await newAccount(connection.pool, ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    const repository = new DrizzleRecurringPaymentRepository(connection.db);
    const scope = await writeScope(ownerId);
    const owner = { ownerId, accountId, categoryId };
    for (let i = 0; i < PAYMENTS; i += 1) {
      await repository.create(
        scope,
        rentOf(owner, {
          name: `Payment ${i}`,
          frequency: 'weekly',
          weekday: i % 7,
          dayOfMonth: null,
          startDate: '2026-01-05',
          scheduleFrom: '2026-01-05',
          autoRecordingFrom: '2026-01-05',
        }),
      );
    }

    const latencies: number[] = [];
    for (let i = 0; i < REQUESTS; i += 1) {
      const started = performance.now();
      const response = await request(harness.app)
        .get('/recurring/upcoming')
        .set(trustedHeaders)
        .set('Cookie', cookieHeader(cookies));
      latencies.push(performance.now() - started);
      expect(response.status).toBe(200);
      expect(upcomingResponseSchema.parse(response.body).items.length).toBeGreaterThan(0);
    }

    const p95 = percentile(latencies, 95);
    console.log(`[08a NFR-02] upcoming: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});
