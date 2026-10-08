import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import type { Express } from 'express';
import request from 'supertest';
import { nextPeriod } from '@pesly/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCreditCardRoutes } from '../../src/credit-cards';
import { DrizzleInstallmentRepository } from '../../src/credit-cards/infrastructure/db/drizzle-installment-repository';
import {
  createAccountMovements,
  createCardPayments,
  createCardPurchases,
  createExpenseCategoryGuard,
  createExpenseRecorder,
  createInstallmentWriteLimit,
  createStatementPaymentRecorder,
} from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { assertIsTestDatabase, testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { newCategory, writeScope } from '../movements/db-fixtures';

/**
 * DISC-001-10c NFR-02 benchmark: p95 of `GET /credit-cards/:id/statements` (statement totals with
 * the installments of the statements) for a card with 60 active installment purchases of 60
 * installments each. Timing-dependent: run it with `pnpm test:perf`, ideally one perf file at a time.
 */

const PURCHASES = 60;
const INSTALLMENTS = 60;
const REQUESTS = 300;
const WARM_UP_REQUESTS = 20;
const CONNECTIONS = 8;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-card-statements@example.com';

let connection: DatabaseConnection;
let server: Server | undefined;

beforeAll(() => {
  assertIsTestDatabase(testDatabaseUrl);
  connection = createDatabase(testDatabaseUrl);
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
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

describe('statement view latency with installments (NFR-02)', () => {
  it('keeps p95 of reading the statements of a card with 60 installment purchases below 300 ms', async () => {
    const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createCreditCardRoutes({
          db: connection.db,
          logger,
          activity: createAccountMovements(connection.db),
          expenses: createExpenseRecorder(connection.db, logger),
          purchases: createCardPurchases(connection.db),
          cardPayments: createCardPayments(connection.db),
          paymentRecorder: createStatementPaymentRecorder(connection.db, logger),
          categories: createExpenseCategoryGuard(connection.db),
          writeLimit: createInstallmentWriteLimit(connection.db, logger),
        }),
      ],
    });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));
    const created = await fetchJson(harness.app, 'post', '/credit-cards', cookies, {
      name: 'Visa',
      closingDay: 24,
      dueDay: 5,
    });
    const cardId = String((created as { id: unknown }).id);
    const statements = (await fetchJson(
      harness.app,
      'get',
      `/credit-cards/${cardId}/statements`,
      cookies,
    )) as { items: { period: string }[] };
    const firstPeriod = statements.items[0]?.period ?? '';
    const categoryId = await newCategory(connection.pool, userId, 'expense');

    const repository = new DrizzleInstallmentRepository(connection.db);
    const scope = await writeScope(userId);
    const periods: string[] = [firstPeriod];
    while (periods.length < INSTALLMENTS) periods.push(nextPeriod(periods.at(-1) ?? firstPeriod));
    for (let i = 0; i < PURCHASES; i += 1) {
      await repository.create(scope, {
        cardId,
        categoryId,
        totalAmount: BigInt(INSTALLMENTS) * 1000n,
        currency: 'ARS',
        purchasedOn: '2026-01-05',
        note: null,
        installments: periods.map((period, index) => ({
          number: index + 1,
          period,
          amount: 1000n,
        })),
      });
    }

    server = createServer(harness.app);
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    const address = listening.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');
    const url = `http://127.0.0.1:${address.port}`;

    const load = async (amount: number) => {
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
                method: 'GET',
                path: `/credit-cards/${cardId}/statements`,
                headers: { ...trustedHeaders, cookie: cookieHeader(cookies) },
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
    };

    const warmUp = await load(WARM_UP_REQUESTS);
    expect(Object.fromEntries(warmUp.statuses)).toEqual({ 200: WARM_UP_REQUESTS });
    const { statuses, latencies } = await load(REQUESTS);
    const p95 = percentile(latencies, 95);
    console.log(
      `[10c NFR-02] statements read: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms (limit ${MAX_P95_MS} ms)`,
    );
    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    expect(p95).toBeLessThan(MAX_P95_MS);
  });
});

async function fetchJson(
  app: Express,
  method: 'get' | 'post',
  path: string,
  cookies: ReturnType<typeof sessionFrom>,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const req = request(app)[method](path).set(trustedHeaders).set('Cookie', cookieHeader(cookies));
  const response = await (method === 'get' ? req : req.send(body));
  if (response.status >= 400) throw new Error(`${method} ${path} answered ${response.status}`);
  return response.body as unknown;
}
