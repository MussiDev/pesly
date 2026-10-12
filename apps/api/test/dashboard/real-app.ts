import type { Express } from 'express';
import request from 'supertest';
import { createBudgetRoutes } from '../../src/budgets';
import { createDashboardRoutes } from '../../src/dashboard';
import { createReportRoutes } from '../../src/reports';
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
import { FixedClock } from './fakes';
import { BUENOS_AIRES, NOW } from './world-fixtures';

export const PASSWORD = 'a long enough passphrase';
let sequence = 0;

/** The dashboard, the 09a reports and the budgets on one app, all on the same fixed clock. */
export function buildRealApp(connection: DatabaseConnection, clock = new FixedClock(NOW)) {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createDashboardRoutes({ db: connection.db, logger, clock }),
      createReportRoutes({ db: connection.db, logger, clock }),
      createBudgetRoutes({ db: connection.db, logger, clock }),
    ],
  });
  return { app: harness.app, lines };
}

export interface RealUser {
  id: string;
  cookies: SessionCookies;
}

export async function addRealUser(
  connection: DatabaseConnection,
  app: Express,
  name: string,
  options: { verified?: boolean } = {},
): Promise<RealUser> {
  sequence += 1;
  const email = `${name}-${sequence}@dashboard-flow.test`;
  const id = await seedUser(connection, {
    email,
    password: PASSWORD,
    timeZone: BUENOS_AIRES,
    ...options,
  });
  return { id, cookies: sessionFrom(await signIn(app, email, PASSWORD)) };
}

export async function getJson(
  app: Express,
  path: string,
  cookies?: SessionCookies,
): Promise<{ status: number; body: unknown; text: string }> {
  const req = request(app).get(path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  const response = await req;
  return { status: response.status, body: response.body as unknown, text: response.text };
}
