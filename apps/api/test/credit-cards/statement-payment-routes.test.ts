import {
  cardExpenseResponseSchema,
  creditCardResponseSchema,
  listMovementsResponseSchema,
  listStatementsResponseSchema,
  statementPaymentResponseSchema,
} from '@pesly/shared';
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
  createMovementRoutes,
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
import { newAccount, newCategory } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
let sequence = 0;

/** "Today" in America/Cordoba (UTC-3) for the seeded users is the date of `now` minus three hours. */
class MovableClock {
  current = new Date('2026-10-06T15:00:00.000Z');

  now(): Date {
    return this.current;
  }
}

async function setup() {
  sequence += 1;
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const clock = new MovableClock();
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createCreditCardRoutes({
        db: connection.db,
        logger,
        activity: createAccountMovements(connection.db),
        expenses: createExpenseRecorder(connection.db, logger, { clock }),
        purchases: createCardPurchases(connection.db),
        cardPayments: createCardPayments(connection.db),
        paymentRecorder: createStatementPaymentRecorder(connection.db, logger, { clock }),
        categories: createExpenseCategoryGuard(connection.db),
        writeLimit: createInstallmentWriteLimit(connection.db, logger, { clock }),
        clock,
      }),
      createMovementRoutes({ db: connection.db, logger, clock }),
      createAccountRoutes({
        db: connection.db,
        logger,
        movements: createAccountMovements(connection.db),
        links: createCardAccountLinks(connection.db),
      }),
    ],
  });
  const anaEmail = `ana-${sequence}@payments.test`;
  const bobEmail = `bob-${sequence}@payments.test`;
  const eveEmail = `eve-${sequence}@payments.test`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  const bobId = await seedUser(connection, { email: bobEmail, password: PASSWORD });
  await seedUser(connection, { email: eveEmail, password: PASSWORD, verified: false });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  const eve = sessionFrom(await signIn(harness.app, eveEmail, PASSWORD));
  return { app: harness.app, clock, lines, anaId, bobId, ana, bob, eve };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function call(
  app: Express,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
) {
  const req = request(app)[method](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return method === 'get' || method === 'delete' ? req : req.send(body);
}

async function createVisa(s: Setup, cookies: SessionCookies = s.ana) {
  const response = await call(s.app, 'post', '/credit-cards', cookies, {
    name: 'Visa',
    closingDay: 24,
    dueDay: 5,
  });
  expect(response.status).toBe(201);
  return creditCardResponseSchema.parse(response.body);
}

const MANUAL_RATE = { source: 'manual', value: '14000000' };

/** A card with a 60,000.00 ARS purchase on 2026-10-05, whose October statement is closed on 2026-11-10. */
async function closedOctober(s: Setup) {
  const card = await createVisa(s);
  const categoryId = await newCategory(connection.pool, s.anaId, 'expense');
  const spent = await call(s.app, 'post', `/credit-cards/${card.id}/expenses`, s.ana, {
    currency: 'ARS',
    categoryId,
    amount: '6000000',
    occurredAt: '2026-10-05T14:00:00.000Z',
    rate: MANUAL_RATE,
  });
  expect(spent.status).toBe(201);
  cardExpenseResponseSchema.parse(spent.body);
  s.clock.current = new Date('2026-11-10T15:00:00.000Z');
  return { card, categoryId };
}

const paymentBody = (sourceAccountId: string, overrides: Record<string, unknown> = {}) => ({
  currency: 'ARS',
  sourceAccountId,
  amount: '6000000',
  occurredAt: '2026-10-06T14:00:00.000Z',
  ...overrides,
});

const pay = (s: Setup, cardId: string, body: Record<string, unknown>, cookies = s.ana) =>
  call(s.app, 'post', `/credit-cards/${cardId}/payments`, cookies, body);

async function october(s: Setup, cardId: string, cookies: SessionCookies = s.ana) {
  const response = await call(s.app, 'get', `/credit-cards/${cardId}/statements`, cookies);
  expect(response.status).toBe(200);
  const found = listStatementsResponseSchema
    .parse(response.body)
    .items.find((item) => item.period === '2026-10');
  if (!found) throw new Error('missing October statement');
  return found;
}

async function balanceOf(s: Setup, accountId: string, cookies: SessionCookies = s.ana) {
  const response = await call(s.app, 'get', `/accounts/${accountId}`, cookies);
  expect(response.status).toBe(200);
  return (response.body as { balance: string }).balance;
}

const countTransfers = async (ownerId: string) =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        `select count(*) as n from movements where owner_id = $1 and type = 'transfer'`,
        [ownerId],
      )
    ).rows[0]?.n,
  );

describe('POST /credit-cards/:id/payments', () => {
  it('moves 60,000.00 ARS from the bank to the card account as a transfer, not an expense (AC-01)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bank = await newAccount(connection.pool, s.anaId);
    s.clock.current = new Date('2026-11-10T15:00:00.000Z');

    const response = await pay(s, card.id, paymentBody(bank));

    expect(response.status).toBe(201);
    expect(statementPaymentResponseSchema.parse(response.body)).toMatchObject({
      sourceAccountId: bank,
      accountId: card.arsAccountId,
      currency: 'ARS',
      amount: '6000000',
    });
    expect(await balanceOf(s, bank)).toBe('-6000000');
    expect(await balanceOf(s, card.arsAccountId)).toBe('6000000');
    const expenses = await call(s.app, 'get', '/movements?type=expense', s.ana);
    expect(listMovementsResponseSchema.parse(expenses.body).items).toEqual([]);
    const transfers = await call(s.app, 'get', '/movements?type=transfer', s.ana);
    expect(listMovementsResponseSchema.parse(transfers.body).items).toHaveLength(1);
  });

  it('keeps the statement purchases unchanged after the payment (AC-01)', async () => {
    const s = await setup();
    const { card } = await closedOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);

    await pay(s, card.id, paymentBody(bank));

    expect((await october(s, card.id)).totals).toEqual({ ARS: '6000000', USD: '0' });
  });

  it('answers 400 MOVEMENT_CURRENCY_MISMATCH from a USD account to the ARS side and stores nothing (AC-02)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const usdBank = await newAccount(connection.pool, s.anaId, false, 'USD');

    const response = await pay(s, card.id, paymentBody(usdBank));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'MOVEMENT_CURRENCY_MISMATCH' });
    expect(await countTransfers(s.anaId)).toBe(0);
  });

  it('reads a closed statement of 60,000.00 ARS paid after a payment of 60,000.00 ARS (AC-03)', async () => {
    const s = await setup();
    const { card } = await closedOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);

    await pay(s, card.id, paymentBody(bank));

    expect((await october(s, card.id)).payments).toEqual({
      ARS: { paid: '6000000', status: 'paid' },
      USD: { paid: '0', status: 'paid' },
    });
  });

  it('reads it partially paid after a payment of 20,000.00 ARS, and unpaid before any (AC-04)', async () => {
    const s = await setup();
    const { card } = await closedOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);
    expect((await october(s, card.id)).payments?.ARS).toEqual({ paid: '0', status: 'unpaid' });

    await pay(s, card.id, paymentBody(bank, { amount: '2000000' }));

    expect((await october(s, card.id)).payments?.ARS).toEqual({
      paid: '2000000',
      status: 'partially_paid',
    });
  });

  it('counts a transfer made with the ordinary form, but not an expense or an outgoing transfer of the card (D2)', async () => {
    const s = await setup();
    const { card } = await closedOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);
    const form = await call(s.app, 'post', '/movements', s.ana, {
      type: 'transfer',
      accountId: bank,
      destinationAccountId: card.arsAccountId,
      amount: '2000000',
      occurredAt: '2026-10-06T14:00:00.000Z',
    });
    expect(form.status).toBe(201);
    const outgoing = await call(s.app, 'post', '/movements', s.ana, {
      type: 'transfer',
      accountId: card.arsAccountId,
      destinationAccountId: bank,
      amount: '500000',
      occurredAt: '2026-10-06T14:00:00.000Z',
    });
    expect(outgoing.status).toBe(201);

    expect((await october(s, card.id)).payments?.ARS).toEqual({
      paid: '2000000',
      status: 'partially_paid',
    });
  });

  it("does not show Ana's payments in Bob's card (sad path, cross-user)", async () => {
    const s = await setup();
    const { card } = await closedOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);
    await pay(s, card.id, paymentBody(bank));
    const bobCard = await createVisa(s, s.bob);

    const response = await call(s.app, 'get', `/credit-cards/${bobCard.id}/statements`, s.bob);

    const [first] = listStatementsResponseSchema.parse(response.body).items;
    expect(first?.payments).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('6000000');
  });

  it("answers 404 for Bob on Ana's card and for Ana's account as Bob's source, storing nothing (sad path)", async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bobCard = await createVisa(s, s.bob);
    const anaBank = await newAccount(connection.pool, s.anaId);
    const bobBank = await newAccount(connection.pool, s.bobId);

    const foreignCard = await pay(s, card.id, paymentBody(bobBank), s.bob);
    const foreignSource = await pay(s, bobCard.id, paymentBody(anaBank), s.bob);

    expect(foreignCard.status).toBe(404);
    expect(foreignSource.status).toBe(404);
    expect(await countTransfers(s.anaId)).toBe(0);
    expect(await countTransfers(s.bobId)).toBe(0);
  });

  it('answers 400 for the card account as source, 409 for an archived source and 400 for a future date (sad path)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const archived = await newAccount(connection.pool, s.anaId, true);
    const bank = await newAccount(connection.pool, s.anaId);

    const same = await pay(s, card.id, paymentBody(card.arsAccountId));
    const archivedResponse = await pay(s, card.id, paymentBody(archived));
    const future = await pay(
      s,
      card.id,
      paymentBody(bank, { occurredAt: '2026-10-08T14:00:00.000Z' }),
    );

    expect(same.status).toBe(400);
    expect(same.body).toMatchObject({ code: 'MOVEMENT_SAME_ACCOUNT' });
    expect(archivedResponse.status).toBe(409);
    expect(archivedResponse.body).toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
    expect(future.status).toBe(400);
    expect(future.body).toMatchObject({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    expect(await countTransfers(s.anaId)).toBe(0);
  });

  it('answers 400 for a destination key, a bad amount and a missing source and stores nothing (invalid input)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bank = await newAccount(connection.pool, s.anaId);

    for (const overrides of [
      { destinationAccountId: bank },
      { amount: '0' },
      { amount: '15.99' },
      { sourceAccountId: undefined },
    ]) {
      const response = await pay(s, card.id, paymentBody(bank, overrides));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await countTransfers(s.anaId)).toBe(0);
  });

  it('round-trips the largest amount, 10^15 minor units, exactly (error path of float handling)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bank = await newAccount(connection.pool, s.anaId);

    const response = await pay(s, card.id, paymentBody(bank, { amount: '1000000000000000' }));

    expect(response.status).toBe(201);
    expect(statementPaymentResponseSchema.parse(response.body).amount).toBe('1000000000000000');
    expect(await balanceOf(s, card.arsAccountId)).toBe('1000000000000000');
  });

  it('answers 429 RATE_LIMITED on the 61st creation of a minute (sad path)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bank = await newAccount(connection.pool, s.anaId);
    const body = paymentBody(bank, { amount: '1' });
    for (let i = 0; i < 60; i += 1) {
      expect((await pay(s, card.id, body)).status).toBe(201);
    }

    const limited = await pay(s, card.id, body);

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ code: 'RATE_LIMITED' });
    expect(await countTransfers(s.anaId)).toBe(60);
  });

  it('answers 401 without a session and 403 before the email is verified (sad path)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bank = await newAccount(connection.pool, s.anaId);

    const anonymous = await call(
      s.app,
      'post',
      `/credit-cards/${card.id}/payments`,
      undefined,
      paymentBody(bank),
    );
    const unverified = await pay(s, card.id, paymentBody(bank), s.eve);

    expect(anonymous.status).toBe(401);
    expect(unverified.status).toBe(403);
    expect(unverified.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('logs ids only: never the amount or the note', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bank = await newAccount(connection.pool, s.anaId);

    await pay(s, card.id, paymentBody(bank, { amount: '1234568', note: 'secret rent' }));

    const logged = s.lines.join('\n');
    expect(logged).toContain(card.id);
    expect(logged).not.toContain('1234568');
    expect(logged).not.toContain('secret rent');
  });
});

describe('POST /credit-cards/:id/payments, USD part from an ARS account', () => {
  const USD_PESOS = '9147065'; // 91,470.65 ARS debited for 59.59 USD at 1535.0000

  /** A card with a 59.59 USD purchase on 2026-10-05, whose October statement is closed. */
  async function closedUsdOctober(s: Setup) {
    const card = await createVisa(s);
    const categoryId = await newCategory(connection.pool, s.anaId, 'expense');
    const spent = await call(s.app, 'post', `/credit-cards/${card.id}/expenses`, s.ana, {
      currency: 'USD',
      categoryId,
      amount: '5959',
      occurredAt: '2026-10-05T14:00:00.000Z',
      rate: MANUAL_RATE,
    });
    expect(spent.status).toBe(201);
    s.clock.current = new Date('2026-11-10T15:00:00.000Z');
    return card;
  }

  const usdBody = (sourceAccountId: string, overrides: Record<string, unknown> = {}) =>
    paymentBody(sourceAccountId, { currency: 'USD', amount: '5959', ...overrides });

  it('records an exchange of the pesos debited and marks the USD part paid (statement example)', async () => {
    const s = await setup();
    const card = await closedUsdOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);

    const response = await pay(s, card.id, usdBody(bank, { pesosAmount: USD_PESOS }));

    expect(response.status).toBe(201);
    expect(statementPaymentResponseSchema.parse(response.body)).toMatchObject({
      accountId: card.usdAccountId,
      currency: 'USD',
      amount: '5959',
      exchange: { pesosAmount: USD_PESOS, rate: '15350000' },
    });
    expect(await balanceOf(s, bank)).toBe(`-${USD_PESOS}`);
    // The 59.59 USD purchase took the card account to -5959; the payment brings it back to zero.
    expect(await balanceOf(s, card.usdAccountId)).toBe('0');
    const exchanges = await call(s.app, 'get', '/movements?type=exchange', s.ana);
    expect(listMovementsResponseSchema.parse(exchanges.body).items).toHaveLength(1);
    expect((await october(s, card.id)).payments?.USD).toEqual({ paid: '5959', status: 'paid' });
  });

  it('derives the pesos from the rate with exact half-up arithmetic', async () => {
    const s = await setup();
    const card = await closedUsdOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);

    const exact = await pay(s, card.id, usdBody(bank, { rate: '15350000' }));
    const rounded = await pay(s, card.id, usdBody(bank, { amount: '1', rate: '15355000' }));

    expect(statementPaymentResponseSchema.parse(exact.body).exchange?.pesosAmount).toBe(USD_PESOS);
    // 1 cent at 1535.5 is 15.355 pesos: rounded half-up to 1536 cents.
    expect(statementPaymentResponseSchema.parse(rounded.body).exchange?.pesosAmount).toBe('1536');
  });

  it('keeps a USD payment from a USD account a plain transfer without exchange data', async () => {
    const s = await setup();
    const card = await closedUsdOctober(s);
    const usdBank = await newAccount(connection.pool, s.anaId, false, 'USD');

    const response = await pay(s, card.id, usdBody(usdBank));

    expect(statementPaymentResponseSchema.parse(response.body).exchange).toBeNull();
    expect((await october(s, card.id)).payments?.USD.status).toBe('paid');
  });

  it('answers 400 without pesos or rate, with both, with pesos from a USD account, and for ARS with pesos (sad path)', async () => {
    const s = await setup();
    const card = await closedUsdOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);
    const usdBank = await newAccount(connection.pool, s.anaId, false, 'USD');

    const responses = [
      await pay(s, card.id, usdBody(bank)),
      await pay(s, card.id, usdBody(bank, { pesosAmount: USD_PESOS, rate: '15350000' })),
      await pay(s, card.id, usdBody(usdBank, { pesosAmount: USD_PESOS })),
      await pay(s, card.id, usdBody(usdBank, { rate: '15350000' })),
      await pay(s, card.id, paymentBody(bank, { pesosAmount: USD_PESOS })),
      await pay(s, card.id, usdBody(bank, { pesosAmount: '0' })),
      await pay(s, card.id, usdBody(bank, { rate: '0' })),
    ];

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect((await october(s, card.id)).payments?.USD.status).toBe('unpaid');
  });

  it('still refuses ARS paid from a USD account (sad path)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const usdBank = await newAccount(connection.pool, s.anaId, false, 'USD');

    const response = await pay(s, card.id, paymentBody(usdBank));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'MOVEMENT_CURRENCY_MISMATCH' });
  });

  it('answers 404 for a foreign card or source and 400 for a future date, storing nothing (sad path)', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bobCard = await createVisa(s, s.bob);
    const anaBank = await newAccount(connection.pool, s.anaId);
    const bobBank = await newAccount(connection.pool, s.bobId);
    const body = { pesosAmount: USD_PESOS };

    const foreignCard = await pay(s, card.id, usdBody(bobBank, body), s.bob);
    const foreignSource = await pay(s, bobCard.id, usdBody(anaBank, body), s.bob);
    const future = await pay(
      s,
      card.id,
      usdBody(anaBank, { ...body, occurredAt: '2026-10-08T14:00:00.000Z' }),
    );

    expect(foreignCard.status).toBe(404);
    expect(foreignSource.status).toBe(404);
    expect(future.status).toBe(400);
    expect(future.body).toMatchObject({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    const stored = await connection.pool.query<{ n: string }>(
      `select count(*) as n from movements where type = 'exchange' and owner_id in ($1, $2)`,
      [s.anaId, s.bobId],
    );
    expect(stored.rows[0]).toEqual({ n: '0' });
  });

  it('accepts the largest amounts and refuses a rate whose pesos exceed the limit', async () => {
    const s = await setup();
    const card = await createVisa(s);
    const bank = await newAccount(connection.pool, s.anaId);

    const max = await pay(
      s,
      card.id,
      usdBody(bank, { amount: '1000000000000000', pesosAmount: '1000000000000000' }),
    );
    const tooMuch = await pay(
      s,
      card.id,
      usdBody(bank, { amount: '1000000000000000', rate: '100000000000' }),
    );

    expect(max.status).toBe(201);
    expect(statementPaymentResponseSchema.parse(max.body).exchange).toEqual({
      pesosAmount: '1000000000000000',
      rate: '10000',
    });
    expect(tooMuch.status).toBe(400);
  });

  it('moves the status when the exchange is edited or deleted through the movements API', async () => {
    const s = await setup();
    const card = await closedUsdOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);
    const paid = statementPaymentResponseSchema.parse(
      (await pay(s, card.id, usdBody(bank, { pesosAmount: USD_PESOS }))).body,
    );

    const edited = await request(s.app)
      .put(`/movements/${paid.movementId}`)
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(s.ana))
      .send({
        type: 'exchange',
        accountId: bank,
        destinationAccountId: card.usdAccountId,
        amount: '4000000',
        destinationAmount: '2000',
        occurredAt: '2026-10-06T14:00:00.000Z',
      });
    expect(edited.status).toBe(200);
    expect((await october(s, card.id)).payments?.USD).toEqual({
      paid: '2000',
      status: 'partially_paid',
    });

    const removed = await call(s.app, 'delete', `/movements/${paid.movementId}`, s.ana);
    expect(removed.status).toBe(204);
    expect((await october(s, card.id)).payments?.USD).toEqual({ paid: '0', status: 'unpaid' });
  });

  it('does not count an exchange out of the card USD account as a payment', async () => {
    const s = await setup();
    const card = await closedUsdOctober(s);
    const bank = await newAccount(connection.pool, s.anaId);
    const out = await call(s.app, 'post', '/movements', s.ana, {
      type: 'exchange',
      accountId: card.usdAccountId,
      destinationAccountId: bank,
      amount: '5959',
      destinationAmount: USD_PESOS,
      occurredAt: '2026-10-06T14:00:00.000Z',
    });
    expect(out.status).toBe(201);

    expect((await october(s, card.id)).payments?.USD).toEqual({ paid: '0', status: 'unpaid' });
  });
});
