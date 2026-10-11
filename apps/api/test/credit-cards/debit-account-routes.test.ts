import { creditCardResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createCardAccountLinks, createCreditCardRoutes } from '../../src/credit-cards';
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
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let sequence = 0;

async function setup() {
  sequence += 1;
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
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
      createAccountRoutes({
        db: connection.db,
        logger,
        movements: createAccountMovements(connection.db),
        links: createCardAccountLinks(connection.db),
      }),
    ],
  });
  const anaEmail = `ana-${sequence}@debit.test`;
  const bobEmail = `bob-${sequence}@debit.test`;
  const eveEmail = `eve-${sequence}@debit.test`;
  await seedUser(connection, { email: anaEmail, password: PASSWORD });
  await seedUser(connection, { email: bobEmail, password: PASSWORD });
  await seedUser(connection, { email: eveEmail, password: PASSWORD, verified: false });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  const eve = sessionFrom(await signIn(harness.app, eveEmail, PASSWORD));
  return { app: harness.app, lines, ana, bob, eve };
}

function call(
  app: Express,
  method: 'get' | 'post' | 'put',
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
) {
  const req = request(app)[method](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return method === 'get' ? req : req.send(body);
}

async function createCard(app: Express, cookies: SessionCookies, name = 'Visa') {
  const response = await call(app, 'post', '/credit-cards', cookies, {
    name,
    closingDay: 24,
    dueDay: 5,
  });
  expect(response.status).toBe(201);
  return creditCardResponseSchema.parse(response.body);
}

async function createBank(
  app: Express,
  cookies: SessionCookies,
  name: string,
  currency: 'ARS' | 'USD' = 'ARS',
) {
  const response = await call(app, 'post', '/accounts', cookies, {
    name,
    type: 'bank_account',
    currency,
  });
  expect(response.status).toBe(201);
  return (response.body as { id: string }).id;
}

const put = (
  s: Awaited<ReturnType<typeof setup>>,
  cardId: string,
  body: Record<string, unknown>,
  cookies: Partial<SessionCookies> = s.ana,
) => call(s.app, 'put', `/credit-cards/${cardId}/debit-accounts`, cookies, body);

const cardOf = async (s: Awaited<ReturnType<typeof setup>>, id: string) =>
  creditCardResponseSchema.parse((await call(s.app, 'get', `/credit-cards/${id}`, s.ana)).body);

describe('PUT /credit-cards/:id/debit-accounts', () => {
  it('links an ARS bank account and shows it on GET (AC-01)', async () => {
    const s = await setup();
    const card = await createCard(s.app, s.ana);
    const bank = await createBank(s.app, s.ana, 'Galicia');
    expect(card.debitArsAccountId).toBeNull();

    const response = await put(s, card.id, { debitArsAccountId: bank, debitUsdAccountId: null });

    expect(response.status).toBe(200);
    expect(creditCardResponseSchema.parse(response.body)).toMatchObject({
      id: card.id,
      debitArsAccountId: bank,
      debitUsdAccountId: null,
    });
    expect(await cardOf(s, card.id)).toMatchObject({ debitArsAccountId: bank });
    const list = await call(s.app, 'get', '/credit-cards', s.ana);
    expect(
      (list.body as { items: { debitArsAccountId: string }[] }).items[0]?.debitArsAccountId,
    ).toBe(bank);
  });

  it('unlinks both accounts with null (AC-04)', async () => {
    const s = await setup();
    const card = await createCard(s.app, s.ana);
    const bank = await createBank(s.app, s.ana, 'Galicia');
    await put(s, card.id, { debitArsAccountId: bank, debitUsdAccountId: null });

    const response = await put(s, card.id, { debitArsAccountId: null, debitUsdAccountId: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ debitArsAccountId: null, debitUsdAccountId: null });
    expect(await cardOf(s, card.id)).toMatchObject({
      debitArsAccountId: null,
      debitUsdAccountId: null,
    });
  });

  it('answers 400 DEBIT_ACCOUNT_CURRENCY_MISMATCH for a USD account on ARS and stores nothing (sad path, AC-02)', async () => {
    const s = await setup();
    const card = await createCard(s.app, s.ana);
    const usd = await createBank(s.app, s.ana, 'Dolares', 'USD');

    const response = await put(s, card.id, { debitArsAccountId: usd, debitUsdAccountId: null });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'DEBIT_ACCOUNT_CURRENCY_MISMATCH' });
    expect(await cardOf(s, card.id)).toMatchObject({ debitArsAccountId: null });
  });

  it('answers 400 DEBIT_ACCOUNT_IS_CARD_ACCOUNT for the own and for another card account (sad path, AC-05)', async () => {
    const s = await setup();
    const visa = await createCard(s.app, s.ana, 'Visa');
    const master = await createCard(s.app, s.ana, 'Master');

    for (const accountId of [visa.arsAccountId, master.arsAccountId]) {
      const response = await put(s, visa.id, {
        debitArsAccountId: accountId,
        debitUsdAccountId: null,
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ code: 'DEBIT_ACCOUNT_IS_CARD_ACCOUNT' });
    }
    expect(await cardOf(s, visa.id)).toMatchObject({ debitArsAccountId: null });
  });

  it("answers 404 for an account of another user, and for Bob on Ana's card (sad path, AC-05)", async () => {
    const s = await setup();
    const card = await createCard(s.app, s.ana);
    const bobAccount = await createBank(s.app, s.bob, 'Bob only');

    const foreignAccount = await put(s, card.id, {
      debitArsAccountId: bobAccount,
      debitUsdAccountId: null,
    });
    expect(foreignAccount.status).toBe(404);
    expect(foreignAccount.body).toEqual({ code: 'NOT_FOUND' });
    expect(await cardOf(s, card.id)).toMatchObject({ debitArsAccountId: null });

    const ownBank = await createBank(s.app, s.bob, 'Bob second');
    const foreignCard = await put(
      s,
      card.id,
      { debitArsAccountId: ownBank, debitUsdAccountId: null },
      s.bob,
    );
    expect(foreignCard.status).toBe(404);
    expect(foreignCard.body).toEqual({ code: 'NOT_FOUND' });
    expect(
      (await put(s, MISSING_ID, { debitArsAccountId: null, debitUsdAccountId: null })).status,
    ).toBe(404);
  });

  it('answers 409 ACCOUNT_ARCHIVED for an archived account (sad path)', async () => {
    const s = await setup();
    const card = await createCard(s.app, s.ana);
    const bank = await createBank(s.app, s.ana, 'Old bank');
    expect((await call(s.app, 'post', `/accounts/${bank}/archive`, s.ana)).status).toBe(200);

    const response = await put(s, card.id, { debitArsAccountId: bank, debitUsdAccountId: null });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_ARCHIVED' });
    expect(await cardOf(s, card.id)).toMatchObject({ debitArsAccountId: null });
  });

  it.each([
    ['a missing key', { debitArsAccountId: null }],
    ['a non-UUID', { debitArsAccountId: 'not-a-uuid', debitUsdAccountId: null }],
    ['an unknown key', { debitArsAccountId: null, debitUsdAccountId: null, extra: 1 }],
  ])('answers 400 VALIDATION_FAILED for %s (sad path)', async (_label, body) => {
    const s = await setup();
    const card = await createCard(s.app, s.ana);
    const response = await put(s, card.id, body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('answers 400 VALIDATION_FAILED for a non-UUID card id (sad path)', async () => {
    const s = await setup();
    const response = await put(s, 'not-a-uuid', {
      debitArsAccountId: null,
      debitUsdAccountId: null,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('answers 401 without a session and 403 with an unverified email (sad path)', async () => {
    const s = await setup();
    const card = await createCard(s.app, s.ana);
    const body = { debitArsAccountId: null, debitUsdAccountId: null };
    expect((await put(s, card.id, body, {})).status).toBe(401);
    const unverified = await put(s, card.id, body, s.eve);
    expect(unverified.status).toBe(403);
    expect(unverified.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('logs the request id, user id and card id and no account id or name (sad path, log content)', async () => {
    const s = await setup();
    const card = await createCard(s.app, s.ana, 'Secretcard');
    const bank = await createBank(s.app, s.ana, 'Secretbank');
    s.lines.length = 0;

    const response = await put(s, card.id, { debitArsAccountId: bank, debitUsdAccountId: null });
    expect(response.status).toBe(200);

    const audit = s.lines.filter((line) => line.includes('debit'));
    expect(audit.length).toBeGreaterThan(0);
    const text = s.lines.join('\n');
    expect(text).toContain(card.id);
    expect(text).toContain('requestId');
    expect(text).toContain('userId');
    expect(text).not.toContain(bank);
    expect(text).not.toContain('Secretbank');
    expect(text).not.toContain('Secretcard');
  });
});
