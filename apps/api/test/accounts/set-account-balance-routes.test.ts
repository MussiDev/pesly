import { randomUUID } from 'node:crypto';
import {
  accountResponseSchema,
  setAccountBalanceResponseSchema,
  type SetAccountBalanceResponse,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createAccountMovements, createBalanceAdjuster } from '../../src/movements';
import { TWO_FACTOR_DISABLE_USER_15M_POLICY } from '../../src/identity/application/attempt-policies';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { seedTwoFactor, totpNow, wrongTotp, STEP_MS } from '../helpers/two-factor-client';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';

interface Setup {
  harness: IdentityHarness;
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  lines: string[];
}

async function setup(): Promise<Setup> {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const routes = createAccountRoutes({
    db: connection.db,
    logger,
    movements: createAccountMovements(connection.db),
    balanceAdjuster: createBalanceAdjuster(connection.db),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes],
  });
  const suffix = randomUUID().slice(0, 8);
  const anaEmail = `ana-${suffix}@example.com`;
  const bobEmail = `bob-${suffix}@example.com`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  return { harness, app: harness.app, ana, bob, anaId, lines };
}

function post(app: Express, path: string, cookies: SessionCookies | undefined, body: unknown) {
  const call = request(app).post(path).set(trustedHeaders);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call.send(body as Record<string, unknown>);
}

async function createAccount(
  s: Setup,
  overrides: Record<string, unknown> = {},
  cookies: SessionCookies = s.ana,
): Promise<string> {
  const response = await post(s.app, '/accounts', cookies, {
    name: `Caja ${randomUUID().slice(0, 6)}`,
    type: 'cash',
    currency: 'ARS',
    ...overrides,
  });
  expect(response.status).toBe(201);
  return accountResponseSchema.parse(response.body).id;
}

async function adjustments(accountId: string) {
  const result = await connection.pool.query<{ amount: string; note: string | null }>(
    "select amount::text, note from movements where account_id = $1 and type = 'adjustment' order by created_at",
    [accountId],
  );
  return result.rows;
}

function codeOf(response: request.Response): unknown {
  return (response.body as { code?: unknown }).code;
}

describe('POST /accounts/:id/balance', () => {
  it('answers 200 with the account and the adjustment of target minus current (AC-01, AC-02)', async () => {
    const s = await setup();
    const id = await createAccount(s, { openingBalance: '1000' });

    const up = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '2500',
      note: 'cash count',
    });
    expect(up.status).toBe(200);
    const upBody: SetAccountBalanceResponse = setAccountBalanceResponseSchema.parse(up.body);
    expect(upBody.account).toMatchObject({ id, balance: '2500', openingBalance: '1000' });
    expect(upBody.adjustment).toMatchObject({
      type: 'adjustment',
      accountId: id,
      amount: '1500',
      note: 'cash count',
      categoryId: null,
      rate: null,
      destinationAccountId: null,
      tags: [],
    });

    const down = await post(s.app, `/accounts/${id}/balance`, s.ana, { balance: '400' });
    expect(down.status).toBe(200);
    expect(setAccountBalanceResponseSchema.parse(down.body).adjustment?.amount).toBe('-2100');
    expect(await adjustments(id)).toEqual([
      { amount: '1500', note: 'cash count' },
      { amount: '-2100', note: null },
    ]);
  });

  it('records nothing and answers adjustment null when the target equals the balance (AC-11)', async () => {
    const s = await setup();
    const id = await createAccount(s, { openingBalance: '700' });
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, { balance: '700' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ adjustment: null, account: { balance: '700' } });
    expect(await adjustments(id)).toHaveLength(0);
  });

  it('accepts a negative target and the limit, and keeps the account in the list consistent (AC-12)', async () => {
    const s = await setup();
    const id = await createAccount(s);
    const negative = await post(s.app, `/accounts/${id}/balance`, s.ana, { balance: '-5000' });
    expect(negative.status).toBe(200);
    expect(negative.body).toMatchObject({ account: { balance: '-5000' } });
    const read = await request(s.app).get(`/accounts/${id}`).set('Cookie', cookieHeader(s.ana));
    expect(read.body).toMatchObject({ balance: '-5000', openingBalance: '0' });
  });

  it.each([
    ['a non-integer', { balance: '1.5' }],
    ['a value above the limit', { balance: '1000000000000001' }],
    ['text', { balance: 'abc' }],
    ['a missing balance', {}],
    ['a number instead of a string', { balance: 5 }],
    ['a malformed second-factor code', { balance: '5', secondFactorCode: 'x' }],
    ['a note with a control character', { balance: '5', note: 'a\u0000b' }],
  ])('answers 400 and records nothing for %s (AC-12) (sad path)', async (_label, body) => {
    const s = await setup();
    const id = await createAccount(s);
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, body);
    expect(response.status).toBe(400);
    expect(await adjustments(id)).toHaveLength(0);
  });

  it('answers 400 on balance and records nothing when the difference exceeds the movement limit (sad path)', async () => {
    const s = await setup();
    const id = await createAccount(s, { openingBalance: '-1000000000000000' });
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '1000000000000000',
    });
    expect(response.status).toBe(400);
    expect((response.body as { fields?: string[] }).fields).toEqual(['body.balance']);
    expect(await adjustments(id)).toHaveLength(0);
  });

  it('answers 400 for a malformed account id (sad path)', async () => {
    const s = await setup();
    const response = await post(s.app, '/accounts/not-a-uuid/balance', s.ana, { balance: '5' });
    expect(response.status).toBe(400);
  });

  it('answers 401 without a session (sad path)', async () => {
    const s = await setup();
    const id = await createAccount(s);
    const response = await post(s.app, `/accounts/${id}/balance`, undefined, { balance: '5' });
    expect(response.status).toBe(401);
  });

  it('answers 404 for another user account and a missing one, and records nothing (AC-16, R-02) (sad path)', async () => {
    const s = await setup();
    const id = await createAccount(s);
    const foreign = await post(s.app, `/accounts/${id}/balance`, s.bob, { balance: '5' });
    const missing = await post(s.app, `/accounts/${randomUUID()}/balance`, s.bob, {
      balance: '5',
    });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(await adjustments(id)).toHaveLength(0);
  });

  it('answers 409 ACCOUNT_ARCHIVED and records nothing for an archived account (AC-14) (sad path)', async () => {
    const s = await setup();
    const id = await createAccount(s);
    expect((await post(s.app, `/accounts/${id}/archive`, s.ana, {})).status).toBe(200);
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, { balance: '5' });
    expect(response.status).toBe(409);
    expect(codeOf(response)).toBe('ACCOUNT_ARCHIVED');
    expect(await adjustments(id)).toHaveLength(0);
  });

  it('answers 422 for a credit card account and records nothing (sad path)', async () => {
    const s = await setup();
    const id = await createAccount(s, { type: 'credit_card' });
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, { balance: '5' });
    expect(response.status).toBe(422);
    expect(await adjustments(id)).toHaveLength(0);
  });

  it('logs ids only, never an amount or the note (audit)', async () => {
    const s = await setup();
    const id = await createAccount(s);
    s.lines.length = 0;
    await post(s.app, `/accounts/${id}/balance`, s.ana, { balance: '987654', note: 'secret note' });
    const audit = s.lines.find((line) => line.includes('account balance adjusted'));
    expect(audit).toBeDefined();
    expect(JSON.parse(audit ?? '{}')).toMatchObject({ accountId: id, userId: s.anaId });
    const everything = s.lines.join('\n');
    expect(everything).not.toContain('987654');
    expect(everything).not.toContain('secret note');
  });

  it('ends 20 concurrent requests with the balance of one of the targets and no lost update (AC-15)', async () => {
    const s = await setup();
    const id = await createAccount(s);
    const targets = Array.from({ length: 20 }, (_, index) => BigInt((index + 1) * 1000));
    const responses = await Promise.all(
      targets.map((target) =>
        post(s.app, `/accounts/${id}/balance`, s.ana, { balance: target.toString() }),
      ),
    );
    for (const response of responses) expect(response.status).toBe(200);
    const read = await request(s.app).get(`/accounts/${id}`).set('Cookie', cookieHeader(s.ana));
    expect(targets.map(String)).toContain((read.body as { balance: string }).balance);
    const total = (await adjustments(id)).reduce((sum, row) => sum + BigInt(row.amount), 0n);
    expect(total.toString()).toBe((read.body as { balance: string }).balance);
  });
});

describe('POST /accounts/:id/balance with 2FA on', () => {
  async function withTwoFactor() {
    const s = await setup();
    const two = await seedTwoFactor(connection, s.anaId, s.harness.clock);
    // Never straddle two 15-minute counter windows: when the current one is about to end, move to
    // the next. The jump stays under a minute so the session signed in above does not expire.
    const window = 15 * 60 * 1000;
    const left = window - (s.harness.clock.now().getTime() % window);
    s.harness.clock.advance(STEP_MS + (left < 60_000 ? left : 0));
    const id = await createAccount(s);
    return { s, two, id };
  }

  async function counted(userId: string): Promise<number> {
    const result = await connection.pool.query<{ n: string }>(
      'select coalesce(sum(count), 0) as n from auth_attempts where kind = $1 and key = $2',
      [TWO_FACTOR_DISABLE_USER_15M_POLICY.kind, userId],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  it('records the adjustment with a valid TOTP code and refuses to replay it (AC-19, R-07)', async () => {
    const { s, two, id } = await withTwoFactor();
    const code = totpNow(two.secret, s.harness.clock);
    const ok = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '100',
      secondFactorCode: code,
    });
    expect(ok.status).toBe(200);
    const replay = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '200',
      secondFactorCode: code,
    });
    expect(replay.status).toBe(400);
    expect(codeOf(replay)).toBe('TOTP_INVALID');
    expect(await adjustments(id)).toHaveLength(1);
  });

  it('accepts an unused recovery code (AC-19)', async () => {
    const { s, two, id } = await withTwoFactor();
    const ok = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '100',
      secondFactorCode: two.recoveryCodes[0],
    });
    expect(ok.status).toBe(200);
  });

  it('answers TOTP_INVALID for a missing code and records nothing (AC-20) (sad path)', async () => {
    const { s, id } = await withTwoFactor();
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, { balance: '100' });
    expect(response.status).toBe(400);
    expect(codeOf(response)).toBe('TOTP_INVALID');
    expect(await adjustments(id)).toHaveLength(0);
    expect(await counted(s.anaId)).toBe(0);
  });

  it('answers TOTP_INVALID for a wrong code, records nothing and counts the attempt (AC-20, R-08) (sad path)', async () => {
    const { s, two, id } = await withTwoFactor();
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '100',
      secondFactorCode: wrongTotp(two.secret, s.harness.clock),
    });
    expect(response.status).toBe(400);
    expect(codeOf(response)).toBe('TOTP_INVALID');
    expect(await adjustments(id)).toHaveLength(0);
    expect(await counted(s.anaId)).toBe(1);
  });

  it('answers 429 once the attempt limit is exhausted, without checking the code (AC-20, R-08) (sad path)', async () => {
    const { s, two, id } = await withTwoFactor();
    const wrong = wrongTotp(two.secret, s.harness.clock);
    for (let i = 0; i < TWO_FACTOR_DISABLE_USER_15M_POLICY.limit; i += 1) {
      const response = await post(s.app, `/accounts/${id}/balance`, s.ana, {
        balance: '100',
        secondFactorCode: wrong,
      });
      expect(codeOf(response)).toBe('TOTP_INVALID');
    }
    const limited = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '100',
      secondFactorCode: totpNow(two.secret, s.harness.clock),
    });
    expect(limited.status).toBe(429);
    expect(await adjustments(id)).toHaveLength(0);
  });

  it('does not ask a code from a user without 2FA even when one is sent and wrong (AC-19)', async () => {
    const s = await setup();
    const id = await createAccount(s);
    const response = await post(s.app, `/accounts/${id}/balance`, s.ana, {
      balance: '100',
      secondFactorCode: '000000',
    });
    expect(response.status).toBe(200);
  });
});
