import type { Express } from 'express';
import request from 'supertest';
import { createBudgetRoutes } from '../../src/budgets';
import { createCategoryRoutes } from '../../src/categories';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { trustedHeaders } from '../helpers/test-env';

export const PASSWORD = 'a long enough passphrase';
let sequence = 0;

/** 16:00 UTC on 2026-10-06 is still 2026-10-06 in America/Argentina/Buenos_Aires. */
export class MovableClock {
  constructor(public current = new Date('2026-10-06T16:00:00.000Z')) {}

  now(): Date {
    return this.current;
  }
}

export interface Owner {
  id: string;
  cookies: SessionCookies;
}

export function buildApp(
  connection: DatabaseConnection,
  clock: MovableClock = new MovableClock(),
  options: { withCategoryRoutes?: boolean } = {},
) {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createBudgetRoutes({ db: connection.db, logger, clock }),
      ...(options.withCategoryRoutes ? [createCategoryRoutes({ db: connection.db, logger })] : []),
    ],
  });
  return { app: harness.app, lines, clock };
}

export async function addUser(
  connection: DatabaseConnection,
  app: Express,
  name: string,
  options: { verified?: boolean } = {},
): Promise<Owner> {
  sequence += 1;
  const email = `${name}-${sequence}@budgets-routes.test`;
  const id = await seedUser(connection, { email, password: PASSWORD, ...options });
  return { id, cookies: sessionFrom(await signIn(app, email, PASSWORD)) };
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/** What the budget routes answer, loosely typed: the tests assert on the fields they care about. */
export interface TestBody {
  id: string;
  amount: string;
  thresholds: number[];
  categoryIds: string[];
  coveredCategoryIds: string[];
  effectiveFrom: string;
  code?: string;
  error?: { code?: string };
}

export async function call(
  app: Express,
  method: Method,
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: TestBody }> {
  const req = request(app)[method](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  const response = await (method === 'get' || method === 'delete' ? req : req.send(body ?? {}));
  return { status: response.status, body: response.body as TestBody };
}
