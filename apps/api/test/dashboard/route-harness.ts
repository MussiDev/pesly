import type { DashboardResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import type { DashboardUseCase } from '../../src/dashboard/application/ports/dashboard-use-case';
import { createDashboardRoutes } from '../../src/dashboard/infrastructure/http/dashboard-routes';
import type { AccessScope } from '../../src/shared/access';
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
import { EMPTY_DASHBOARD_RESPONSE, FixedClock } from './fakes';

export const PASSWORD = 'a long enough passphrase';
let sequence = 0;

export interface Owner {
  id: string;
  cookies: SessionCookies;
}

/** A fake use case that records the scopes it was called with. */
export function buildApp(
  connection: DatabaseConnection,
  respond: () => Promise<DashboardResponse> = () => Promise.resolve(EMPTY_DASHBOARD_RESPONSE),
) {
  const scopes: AccessScope[] = [];
  const useCase: DashboardUseCase = {
    execute(scope) {
      scopes.push(scope);
      return respond();
    },
  };
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createDashboardRoutes({
        db: connection.db,
        logger,
        clock: new FixedClock(),
        useCase,
      }),
    ],
  });
  return { app: harness.app, scopes, lines };
}

export async function addUser(
  connection: DatabaseConnection,
  app: Express,
  name: string,
  options: { verified?: boolean } = {},
): Promise<Owner> {
  sequence += 1;
  const email = `${name}-${sequence}@dashboard-routes.test`;
  const id = await seedUser(connection, { email, password: PASSWORD, ...options });
  return { id, cookies: sessionFrom(await signIn(app, email, PASSWORD)) };
}

export interface DashboardBody {
  code?: string;
  message?: string;
  stack?: unknown;
  netWorth?: unknown;
  firstSteps?: unknown;
}

export async function get(
  app: Express,
  path: string,
  options: { cookies?: Partial<SessionCookies>; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: DashboardBody }> {
  const req = request(app).get(path).set(trustedHeaders);
  if (options.headers) req.set(options.headers);
  if (options.cookies) req.set('Cookie', cookieHeader(options.cookies));
  const response = await req;
  return { status: response.status, body: response.body as DashboardBody };
}
