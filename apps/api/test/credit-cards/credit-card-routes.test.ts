import {
  cardExpenseResponseSchema,
  creditCardResponseSchema,
  listMovementsResponseSchema,
  listStatementsResponseSchema,
  type CreditCardResponse,
  type StatementResponse,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  createMovementRoutes,
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
import { newCategory, newMovement } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await connection.pool.query(`delete from exchange_rates where rate_type in ('blue', 'mep')`);
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
  const anaEmail = `ana-${sequence}@cards.test`;
  const bobEmail = `bob-${sequence}@cards.test`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const unverifiedEmail = `eve-${sequence}@cards.test`;
  await seedUser(connection, { email: unverifiedEmail, password: PASSWORD, verified: false });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  const eve = sessionFrom(await signIn(harness.app, unverifiedEmail, PASSWORD));
  return { app: harness.app, clock, lines, anaId, ana, bob, eve };
}

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

async function createVisa(
  app: Express,
  cookies: SessionCookies,
  body: Record<string, unknown> = { name: 'Visa', closingDay: 24, dueDay: 5 },
) {
  const response = await call(app, 'post', '/credit-cards', cookies, body);
  expect(response.status).toBe(201);
  return creditCardResponseSchema.parse(response.body);
}

async function statementsOf(app: Express, cookies: SessionCookies, cardId: string) {
  const response = await call(app, 'get', `/credit-cards/${cardId}/statements`, cookies);
  expect(response.status).toBe(200);
  return listStatementsResponseSchema.parse(response.body).items;
}

const byPeriod = (items: StatementResponse[], period: string) =>
  items.find((item) => item.period === period);

describe('POST /credit-cards and GET /credit-cards', () => {
  it('creates "Visa" 24/5, lists it, and shows its two linked credit card accounts (AC-01, AC-03)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);

    const list = await call(s.app, 'get', '/credit-cards', s.ana);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ items: [card] });
    expect(card).toMatchObject({ debitArsAccountId: null, debitUsdAccountId: null });
    const accounts = await call(s.app, 'get', '/accounts', s.ana);
    const linked = (
      accounts.body as { items: { id: string; name: string; type: string; currency: string }[] }
    ).items
      .filter((account) => [card.arsAccountId, card.usdAccountId].includes(account.id))
      .map(({ name, type, currency }) => ({ name, type, currency }));
    expect(linked).toEqual(
      expect.arrayContaining([
        { name: 'Visa ARS', type: 'credit_card', currency: 'ARS' },
        { name: 'Visa USD', type: 'credit_card', currency: 'USD' },
      ]),
    );
    expect(s.lines.join('\n')).not.toContain('Visa');
  });

  it.each([
    { closingDay: 0, dueDay: 5 },
    { closingDay: 24, dueDay: 32 },
  ])('answers 400 for days %o and stores nothing (invalid input, AC-02)', async (days) => {
    const s = await setup();
    const response = await call(s.app, 'post', '/credit-cards', s.ana, { name: 'Visa', ...days });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await call(s.app, 'get', '/credit-cards', s.ana)).body).toEqual({ items: [] });
  });

  it('answers 409 ACCOUNT_NAME_TAKEN when "Visa ARS" already exists (sad path, D3)', async () => {
    const s = await setup();
    await call(s.app, 'post', '/accounts', s.ana, {
      name: 'Visa ARS',
      type: 'cash',
      currency: 'ARS',
    });
    const response = await call(s.app, 'post', '/credit-cards', s.ana, {
      name: 'Visa',
      closingDay: 24,
      dueDay: 5,
    });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_NAME_TAKEN' });
  });

  it("keeps Bob's list free of Ana's cards (AC-11)", async () => {
    const s = await setup();
    await createVisa(s.app, s.ana);
    expect((await call(s.app, 'get', '/credit-cards', s.bob)).body).toEqual({ items: [] });
  });
});

describe('statements', () => {
  it('returns the open October statement closing 2026-10-24 and due 2026-11-05 (AC-04)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    expect(await statementsOf(s.app, s.ana, card.id)).toEqual([
      expect.objectContaining({
        cardId: card.id,
        period: '2026-10',
        closingDate: '2026-10-24',
        dueDate: '2026-11-05',
        status: 'open',
        totals: { ARS: '0', USD: '0' },
      }),
    ]);
  });

  it('moves the closing date to 2026-10-26 and a re-read shows it (AC-06)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const [october] = await statementsOf(s.app, s.ana, card.id);
    const response = await call(
      s.app,
      'patch',
      `/credit-cards/${card.id}/statements/${october?.id ?? ''}`,
      s.ana,
      { closingDate: '2026-10-26' },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ closingDate: '2026-10-26', status: 'open' });
    expect((await statementsOf(s.app, s.ana, card.id))[0]?.closingDate).toBe('2026-10-26');
  });

  it('answers 400 for dates that break the order and leaves the statement (invalid input, D9)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const [october] = await statementsOf(s.app, s.ana, card.id);
    const response = await call(
      s.app,
      'patch',
      `/credit-cards/${card.id}/statements/${october?.id ?? ''}`,
      s.ana,
      { dueDate: '2026-10-20' },
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'VALIDATION_FAILED', fields: ['body.dueDate'] });
  });

  it('marks the statement closed once 2026-10-24 has ended in the user zone (AC-09)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    s.clock.current = new Date('2026-10-25T02:59:00.000Z');
    expect(byPeriod(await statementsOf(s.app, s.ana, card.id), '2026-10')?.status).toBe('open');
    s.clock.current = new Date('2026-10-25T03:00:00.000Z');
    const after = await statementsOf(s.app, s.ana, card.id);
    expect(byPeriod(after, '2026-10')?.status).toBe('closed');
    expect(byPeriod(after, '2026-11')?.status).toBe('open');
  });

  it('answers 409 STATEMENT_CLOSED for a closed statement and changes nothing (sad path, AC-07)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const [october] = await statementsOf(s.app, s.ana, card.id);
    s.clock.current = new Date('2026-11-01T15:00:00.000Z');
    const response = await call(
      s.app,
      'patch',
      `/credit-cards/${card.id}/statements/${october?.id ?? ''}`,
      s.ana,
      { closingDate: '2026-10-26' },
    );
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'STATEMENT_CLOSED' });
    expect(byPeriod(await statementsOf(s.app, s.ana, card.id), '2026-10')?.closingDate).toBe(
      '2026-10-24',
    );
  });
});

describe('PATCH /credit-cards/:id', () => {
  it('moves the open statement to day 20 and leaves the closed one (AC-08)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    s.clock.current = new Date('2026-10-28T15:00:00.000Z');
    await statementsOf(s.app, s.ana, card.id);

    const response = await call(s.app, 'patch', `/credit-cards/${card.id}`, s.ana, {
      closingDay: 20,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ closingDay: 20, dueDay: 5 });
    const statements = await statementsOf(s.app, s.ana, card.id);
    expect(byPeriod(statements, '2026-11')?.closingDate).toBe('2026-11-20');
    expect(byPeriod(statements, '2026-10')?.closingDate).toBe('2026-10-24');
  });

  it('answers 400 for an empty body or a name (invalid input, D4)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    for (const body of [{}, { name: 'Other' }]) {
      const response = await call(s.app, 'patch', `/credit-cards/${card.id}`, s.ana, body);
      expect(response.status).toBe(400);
    }
  });
});

describe('DELETE /credit-cards/:id', () => {
  it('answers 204 and removes the card and its two accounts (FR-08, D1)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const response = await call(s.app, 'delete', `/credit-cards/${card.id}`, s.ana);
    expect(response.status).toBe(204);
    expect((await call(s.app, 'get', `/credit-cards/${card.id}`, s.ana)).status).toBe(404);
    expect((await call(s.app, 'get', `/accounts/${card.usdAccountId}`, s.ana)).status).toBe(404);
  });

  it('answers 409 CARD_HAS_MOVEMENTS when a linked account has a movement (sad path, D1)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const categoryId = await newCategory(connection.pool, s.anaId, 'expense');
    await newMovement(connection.pool, {
      ownerId: s.anaId,
      accountId: card.arsAccountId,
      categoryId,
      type: 'expense',
      amount: 100n,
    });
    const response = await call(s.app, 'delete', `/credit-cards/${card.id}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'CARD_HAS_MOVEMENTS' });
    expect((await call(s.app, 'get', `/credit-cards/${card.id}`, s.ana)).status).toBe(200);
  });

  it('refuses to delete a linked account through the accounts API (sad path, D2)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const response = await call(s.app, 'delete', `/accounts/${card.arsAccountId}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_LINKED_TO_CARD' });
  });
});

describe('access control', () => {
  it("answers 404 to Bob for every route on Ana's card and statements and changes nothing (sad path, AC-10)", async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const [october] = await statementsOf(s.app, s.ana, card.id);
    const statementPath = `/credit-cards/${card.id}/statements/${october?.id ?? ''}`;

    const responses = await Promise.all([
      call(s.app, 'get', `/credit-cards/${card.id}`, s.bob),
      call(s.app, 'patch', `/credit-cards/${card.id}`, s.bob, { closingDay: 20 }),
      call(s.app, 'delete', `/credit-cards/${card.id}`, s.bob),
      call(s.app, 'get', `/credit-cards/${card.id}/statements`, s.bob),
      call(s.app, 'patch', statementPath, s.bob, { closingDate: '2026-10-26' }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    const [unchanged] = await statementsOf(s.app, s.ana, card.id);
    expect(unchanged?.closingDate).toBe('2026-10-24');
    expect((await call(s.app, 'get', `/credit-cards/${card.id}`, s.ana)).body).toMatchObject({
      closingDay: 24,
    });
  });

  it('answers 401 without a session and 403 before the email is verified (sad path)', async () => {
    const s = await setup();
    expect((await call(s.app, 'get', '/credit-cards')).status).toBe(401);
    const unverified = await call(s.app, 'get', '/credit-cards', s.eve);
    expect(unverified.status).toBe(403);
    expect(unverified.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('answers 400 for a malformed id (invalid input)', async () => {
    const s = await setup();
    expect((await call(s.app, 'get', '/credit-cards/not-a-uuid', s.ana)).status).toBe(400);
  });

  it('refuses a state-changing request without the origin header (sad path, R-01)', async () => {
    const s = await setup();
    const response = await request(s.app)
      .post('/credit-cards')
      .set('Cookie', cookieHeader(s.ana))
      .send({ name: 'Visa', closingDay: 24, dueDay: 5 });
    expect(response.status).toBe(403);
    expect((await call(s.app, 'get', '/credit-cards', s.ana)).body).toEqual({ items: [] });
  });
});

type Setup = Awaited<ReturnType<typeof setup>>;

describe('POST /credit-cards/:id/expenses', () => {
  const MANUAL_RATE = { source: 'manual', value: '14000000' };

  async function cardWithCategory(s: Setup) {
    const card = await createVisa(s.app, s.ana);
    const categoryId = await newCategory(connection.pool, s.anaId, 'expense');
    return { card, categoryId };
  }

  const expenseBody = (categoryId: string, overrides: Record<string, unknown> = {}) => ({
    currency: 'USD',
    categoryId,
    amount: '1599',
    occurredAt: '2026-10-06T14:00:00.000Z',
    rate: MANUAL_RATE,
    ...overrides,
  });

  const postExpense = (
    s: Setup,
    cardId: string,
    body: Record<string, unknown>,
    cookies: Partial<SessionCookies> | undefined = s.ana,
  ) => call(s.app, 'post', `/credit-cards/${cardId}/expenses`, cookies, body);

  async function totalsOf(s: Setup, card: CreditCardResponse) {
    return (await statementsOf(s.app, s.ana, card.id)).map(({ period, totals }) => ({
      period,
      totals,
    }));
  }

  const countMovements = async (ownerId: string) =>
    Number(
      (
        await connection.pool.query<{ n: string }>(
          'select count(*) as n from movements where owner_id = $1',
          [ownerId],
        )
      ).rows[0]?.n,
    );

  it('records 15.99 USD on the USD account and GET /movements shows it there (AC-01)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const response = await postExpense(s, card.id, expenseBody(categoryId));

    expect(response.status).toBe(201);
    const recorded = cardExpenseResponseSchema.parse(response.body);
    expect(recorded).toMatchObject({
      accountId: card.usdAccountId,
      currency: 'USD',
      amount: '1599',
      occurredAt: '2026-10-06T14:00:00.000Z',
    });
    expect(recorded.statementId).not.toBeNull();
    const listed = await call(s.app, 'get', `/movements?accountId=${card.usdAccountId}`, s.ana);
    expect(listed.status).toBe(200);
    expect(
      listMovementsResponseSchema
        .parse(listed.body)
        .items.map(({ id, amount }) => ({ id, amount })),
    ).toEqual([{ id: recorded.movementId, amount: '1599' }]);
  });

  it('sends an ARS expense to the ARS account', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const response = await postExpense(s, card.id, expenseBody(categoryId, { currency: 'ARS' }));
    expect(response.status).toBe(201);
    expect(cardExpenseResponseSchema.parse(response.body).accountId).toBe(card.arsAccountId);
  });

  it('puts the 24th and the 25th in different statements when the card closes on the 24th (AC-02, AC-03)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await statementsOf(s.app, s.ana, card.id);
    s.clock.current = new Date('2026-10-25T15:00:00.000Z');

    const onClosing = await postExpense(
      s,
      card.id,
      expenseBody(categoryId, { occurredAt: '2026-10-24T15:00:00.000Z', amount: '1000' }),
    );
    const afterClosing = await postExpense(
      s,
      card.id,
      expenseBody(categoryId, { occurredAt: '2026-10-25T15:00:00.000Z', amount: '2500' }),
    );

    const october = cardExpenseResponseSchema.parse(onClosing.body);
    const november = cardExpenseResponseSchema.parse(afterClosing.body);
    expect(october.statementId).not.toBe(november.statementId);
    expect(await totalsOf(s, card)).toEqual(
      expect.arrayContaining([
        { period: '2026-10', totals: { ARS: '0', USD: '1000' } },
        { period: '2026-11', totals: { ARS: '0', USD: '2500' } },
      ]),
    );
  });

  it('moves the purchases of the 25th and 26th into the statement when its closing date moves to the 26th (AC-04)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await statementsOf(s.app, s.ana, card.id);
    s.clock.current = new Date('2026-10-26T15:00:00.000Z');
    for (const day of ['25', '26']) {
      const response = await postExpense(
        s,
        card.id,
        expenseBody(categoryId, { occurredAt: `2026-10-${day}T15:00:00.000Z`, amount: '700' }),
      );
      expect(response.status).toBe(201);
    }
    // The October statement is open again: its status is derived from the clock, never stored.
    s.clock.current = new Date('2026-10-24T15:00:00.000Z');
    const october = byPeriod(await statementsOf(s.app, s.ana, card.id), '2026-10');
    expect(october?.totals).toEqual({ ARS: '0', USD: '0' });

    const patched = await call(
      s.app,
      'patch',
      `/credit-cards/${card.id}/statements/${october?.id ?? ''}`,
      s.ana,
      { closingDate: '2026-10-26' },
    );

    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ totals: { ARS: '0', USD: '1400' } });
    expect(byPeriod(await statementsOf(s.app, s.ana, card.id), '2026-10')?.totals).toEqual({
      ARS: '0',
      USD: '1400',
    });
  });

  it('reads totals of 50,000.00 ARS and 20.00 USD as exact minor-unit strings (AC-05)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await postExpense(s, card.id, expenseBody(categoryId, { currency: 'ARS', amount: '5000000' }));
    await postExpense(s, card.id, expenseBody(categoryId, { currency: 'USD', amount: '2000' }));

    expect(byPeriod(await statementsOf(s.app, s.ana, card.id), '2026-10')?.totals).toEqual({
      ARS: '5000000',
      USD: '2000',
    });
  });

  it.each([
    ['an accountId key', { accountId: '2f1c6c1e-7a0b-4a70-9e9b-0d9d1e0f7a11' }],
    ['currency EUR', { currency: 'EUR' }],
    ['amount 0', { amount: '0' }],
  ])('answers 400 for %s and records nothing (invalid input)', async (_name, overrides) => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const response = await postExpense(s, card.id, expenseBody(categoryId, overrides));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it("answers 404 to Bob on Ana's card and records nothing (sad path)", async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const response = await postExpense(s, card.id, expenseBody(categoryId), s.bob);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('answers 400 MOVEMENT_DATE_IN_FUTURE for a date after today and records nothing (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const response = await postExpense(
      s,
      card.id,
      expenseBody(categoryId, { occurredAt: '2026-10-09T15:00:00.000Z' }),
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('answers 409 CATEGORY_ARCHIVED for an archived category (sad path)', async () => {
    const s = await setup();
    const card = await createVisa(s.app, s.ana);
    const archived = await newCategory(connection.pool, s.anaId, 'expense', true);
    const response = await postExpense(s, card.id, expenseBody(archived));
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'CATEGORY_ARCHIVED' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('answers 400 RATE_REQUIRED for an automatic rate with none stored (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const response = await postExpense(
      s,
      card.id,
      expenseBody(categoryId, { rate: { source: 'automatic' } }),
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'RATE_REQUIRED' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('answers 429 RATE_LIMITED on the 61st expense of a minute (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    for (let i = 0; i < 60; i += 1) {
      expect((await postExpense(s, card.id, expenseBody(categoryId))).status).toBe(201);
    }
    const limited = await postExpense(s, card.id, expenseBody(categoryId));
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ code: 'RATE_LIMITED' });
    expect(await countMovements(s.anaId)).toBe(60);
  });

  it('answers 401 without a session and 403 before the email is verified (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const anonymous = await call(
      s.app,
      'post',
      `/credit-cards/${card.id}/expenses`,
      undefined,
      expenseBody(categoryId),
    );
    expect(anonymous.status).toBe(401);
    const unverified = await postExpense(s, card.id, expenseBody(categoryId), s.eve);
    expect(unverified.status).toBe(403);
    expect(unverified.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('logs ids only: never the amount or the note (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const response = await postExpense(
      s,
      card.id,
      expenseBody(categoryId, { amount: '123457', note: 'secret lunch' }),
    );
    expect(response.status).toBe(201);
    const logged = s.lines.join('\n');
    expect(logged).toContain(card.id);
    expect(logged).not.toContain('123457');
    expect(logged).not.toContain('secret lunch');
  });
});
