import {
  groupDetailResponseSchema,
  groupResponseSchema,
  type GroupDetailResponse,
  type GroupResponse,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createGroupRoutes } from '../../src/groups';
import { createAccountMovements, createMovementRoutes } from '../../src/movements';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
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

export interface TestUser {
  id: string;
  email: string;
  cookies: SessionCookies;
}

export type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export function call(
  app: Express,
  method: Method,
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
) {
  const req = request(app)[method](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return method === 'get' || method === 'delete' ? req : req.send(body ?? {});
}

/** The groups routes over a real session stack; the groups clock is movable. */
export function setupGroupApi(
  connection: DatabaseConnection,
  options: { withAccountRoutes?: boolean } = {},
) {
  const groupLines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => groupLines.push(line) },
  });
  const clock = new MutableClock(new Date('2026-10-10T12:00:00.000Z'));
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createGroupRoutes({ db: connection.db, logger, clock }),
      ...(options.withAccountRoutes
        ? [
            createAccountRoutes({
              db: connection.db,
              logger,
              movements: createAccountMovements(connection.db),
            }),
            createMovementRoutes({ db: connection.db, logger, clock }),
          ]
        : []),
    ],
  });

  async function makeUser(name: string): Promise<TestUser> {
    sequence += 1;
    const email = `${name}-${sequence}@groups.test`;
    const id = await seedUser(connection, { email, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    return { id, email, cookies };
  }

  return {
    app: harness.app,
    clock,
    makeUser,
    /** Every log line of the app and of the groups module. */
    logLines: (): string[] => [...harness.lines, ...groupLines],
  };
}

export async function createGroup(
  app: Express,
  user: TestUser,
  body: Record<string, unknown> = { name: 'Casa', defaultRateType: 'mep' },
): Promise<GroupResponse> {
  const response = await call(app, 'post', '/groups', user.cookies, body);
  expect(response.status).toBe(201);
  return groupResponseSchema.parse(response.body);
}

export async function readGroup(
  app: Express,
  user: TestUser,
  groupId: string,
): Promise<GroupDetailResponse> {
  const response = await call(app, 'get', `/groups/${groupId}`, user.cookies);
  expect(response.status).toBe(200);
  return groupDetailResponseSchema.parse(response.body);
}

export async function invitationTokenOf(
  app: Express,
  user: TestUser,
  groupId: string,
): Promise<string> {
  const response = await call(app, 'post', `/groups/${groupId}/invitations`, user.cookies);
  expect(response.status).toBe(201);
  return (response.body as { token: string }).token;
}
