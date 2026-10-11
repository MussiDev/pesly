import type { Express } from 'express';
import request from 'supertest';
import { createAccountRoutes } from '../../src/accounts';
import { createCardAccountLinks } from '../../src/credit-cards';
import { createGoalRoutes } from '../../src/goals';
import { createAccountMovements } from '../../src/movements';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import type { SessionCookies } from '../helpers/session-client';
import { trustedHeaders } from '../helpers/test-env';

export const PASSWORD = 'a long enough passphrase';
let sequence = 0;

/** At 15:00 UTC the date is 2026-10-15 in America/Cordoba (UTC-3), the seeded users' zone. */
export class MovableClock {
  current = new Date('2026-10-15T15:00:00.000Z');

  now(): Date {
    return this.current;
  }
}

export interface Owner {
  id: string;
  cookies: SessionCookies;
}

export type Method = 'get' | 'post' | 'patch' | 'delete';

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

/** Goal and account routes over the real adapters, sharing one movable clock and one log buffer. */
export function goalsSetup(connection: DatabaseConnection) {
  sequence += 1;
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const clock = new MovableClock();
  const routerFactories = () => [
    createGoalRoutes({
      db: connection.db,
      logger,
      movements: createAccountMovements(connection.db),
      clock,
    }),
    createAccountRoutes({
      db: connection.db,
      logger,
      movements: createAccountMovements(connection.db),
      links: createCardAccountLinks(connection.db),
    }),
  ];
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: routerFactories(),
  });
  const addUser = async (name: string, options: { verified?: boolean } = {}): Promise<Owner> => {
    const email = `${name}-${sequence}@goals.test`;
    const id = await seedUser(connection, { email, password: PASSWORD, ...options });
    const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    return { id, cookies };
  };
  return { app: harness.app, clock, lines, addUser, logger, harness, routerFactories };
}

export type GoalsSetup = Awaited<ReturnType<typeof goalsSetup>>;

/** An account of `owner` created through the accounts route; returns its id. */
export async function createAccount(
  s: Pick<GoalsSetup, 'app'>,
  owner: Owner,
  currency: 'ARS' | 'USD',
  openingBalance = '0',
): Promise<string> {
  const created = await call(s.app, 'post', '/accounts', owner.cookies, {
    name: 'Caja',
    type: 'cash',
    currency,
    openingBalance,
  });
  if (created.status !== 201) throw new Error(`account not created: ${created.status}`);
  return (created.body as { id: string }).id;
}
