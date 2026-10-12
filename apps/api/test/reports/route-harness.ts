import type { Express } from 'express';
import request from 'supertest';
import { createReportRoutes } from '../../src/reports';
import type { ReportUseCases } from '../../src/reports/application/ports/report-use-cases';
import { prepareReport } from '../../src/reports/application/prepare-report';
import { DrizzleReportFilterReader } from '../../src/reports/infrastructure/db/drizzle-report-filter-reader';
import { DrizzleReportPreferences } from '../../src/reports/infrastructure/db/drizzle-report-preferences';
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
import {
  EMPTY_CATEGORY_RESPONSE,
  EMPTY_FLOW_RESPONSE,
  EMPTY_NET_WORTH_RESPONSE,
  FixedClock,
} from './fakes';

export const PASSWORD = 'a long enough passphrase';
let sequence = 0;

export interface Owner {
  id: string;
  cookies: SessionCookies;
}

/**
 * Fake use cases that only run `prepareReport` (the real first step, on the real readers) and
 * return a valid empty response, counting how many times they were called.
 */
export function buildApp(connection: DatabaseConnection) {
  const clock = new FixedClock();
  const calls = { expensesByCategory: 0, incomeExpenses: 0, netWorth: 0 };
  const deps = {
    clock,
    preferences: new DrizzleReportPreferences(connection.db),
    filters: new DrizzleReportFilterReader(connection.db),
  };
  const useCases: ReportUseCases = {
    expensesByCategory: {
      async execute(scope, query) {
        calls.expensesByCategory += 1;
        await prepareReport(deps, scope, query, { maxMonths: 24, defaultMonths: 1 });
        return EMPTY_CATEGORY_RESPONSE;
      },
    },
    incomeExpenses: {
      async execute(scope, query) {
        calls.incomeExpenses += 1;
        await prepareReport(deps, scope, query, { maxMonths: 12, defaultMonths: 12 });
        return EMPTY_FLOW_RESPONSE;
      },
    },
    netWorth: {
      async execute(scope, query) {
        calls.netWorth += 1;
        await prepareReport(deps, scope, query, { maxMonths: 24, defaultMonths: 12 });
        return EMPTY_NET_WORTH_RESPONSE;
      },
    },
  };
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createReportRoutes({ db: connection.db, logger, clock, useCases })],
  });
  return { app: harness.app, calls, lines };
}

export async function addUser(
  connection: DatabaseConnection,
  app: Express,
  name: string,
  options: { verified?: boolean } = {},
): Promise<Owner> {
  sequence += 1;
  const email = `${name}-${sequence}@reports-routes.test`;
  const id = await seedUser(connection, { email, password: PASSWORD, ...options });
  return { id, cookies: sessionFrom(await signIn(app, email, PASSWORD)) };
}

export interface ReportBody {
  total?: string;
  code?: string;
  details?: Record<string, string>;
  fields?: string[];
}

export async function get(
  app: Express,
  path: string,
  cookies?: Partial<SessionCookies>,
): Promise<{ status: number; body: ReportBody }> {
  const req = request(app).get(path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  const response = await req;
  return { status: response.status, body: response.body as ReportBody };
}
