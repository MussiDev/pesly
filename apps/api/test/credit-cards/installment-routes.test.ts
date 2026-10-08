import {
  creditCardResponseSchema,
  installmentExpensesResponseSchema,
  installmentPurchaseResponseSchema,
  listInstallmentPurchasesResponseSchema,
  listStatementsResponseSchema,
  type CreditCardResponse,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCategoryRoutes } from '../../src/categories';
import {
  createCardAccountLinks,
  createCreditCardRoutes,
  createInstallmentCategoryUsage,
} from '../../src/credit-cards';
import { createAccountRoutes } from '../../src/accounts';
import {
  createAccountMovements,
  createCardPayments,
  createCardPurchases,
  createCategoryUsage,
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
import { newCategory } from '../movements/db-fixtures';

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
  const movementUsage = createCategoryUsage(connection.db);
  const installmentUsage = createInstallmentCategoryUsage(connection.db);
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
      createCategoryRoutes({
        db: connection.db,
        logger,
        usage: {
          isUsed: async (id: string) =>
            (await movementUsage.isUsed(id)) || (await installmentUsage.isUsed(id)),
        },
      }),
      createAccountRoutes({
        db: connection.db,
        logger,
        movements: createAccountMovements(connection.db),
        links: createCardAccountLinks(connection.db),
      }),
    ],
  });
  const anaEmail = `ana-${sequence}@installments.test`;
  const bobEmail = `bob-${sequence}@installments.test`;
  const eveEmail = `eve-${sequence}@installments.test`;
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

async function cardWithCategory(s: Setup) {
  const created = await call(s.app, 'post', '/credit-cards', s.ana, {
    name: 'Visa',
    closingDay: 24,
    dueDay: 5,
  });
  expect(created.status).toBe(201);
  const card: CreditCardResponse = creditCardResponseSchema.parse(created.body);
  const categoryId = await newCategory(connection.pool, s.anaId, 'expense');
  return { card, categoryId };
}

const purchaseBody = (categoryId: string, overrides: Record<string, unknown> = {}) => ({
  currency: 'ARS',
  categoryId,
  amount: '12000000',
  installments: 12,
  purchasedOn: '2026-10-06',
  ...overrides,
});

const post = (s: Setup, cardId: string, body: Record<string, unknown>, cookies = s.ana) =>
  call(s.app, 'post', `/credit-cards/${cardId}/installment-purchases`, cookies, body);

async function record(s: Setup, cardId: string, body: Record<string, unknown>) {
  const response = await post(s, cardId, body);
  expect(response.status).toBe(201);
  return installmentPurchaseResponseSchema.parse(response.body);
}

async function listOf(s: Setup, cardId: string) {
  const response = await call(s.app, 'get', `/credit-cards/${cardId}/installment-purchases`, s.ana);
  expect(response.status).toBe(200);
  return listInstallmentPurchasesResponseSchema.parse(response.body);
}

async function statementsOf(s: Setup, cardId: string) {
  const response = await call(s.app, 'get', `/credit-cards/${cardId}/statements`, s.ana);
  expect(response.status).toBe(200);
  return listStatementsResponseSchema.parse(response.body).items;
}

const countPurchases = async (ownerId: string) =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        'select count(*) as n from installment_purchases where owner_id = $1',
        [ownerId],
      )
    ).rows[0]?.n,
  );

describe('POST /credit-cards/:id/installment-purchases', () => {
  it('answers 201 with 12 installments for 120,000.00 ARS and lists it (AC-01)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const purchase = await record(s, card.id, purchaseBody(categoryId, { note: 'Heladera' }));

    expect(purchase.installmentCount).toBe(12);
    expect(purchase.installments).toHaveLength(12);
    expect(purchase.installments.every((i) => i.amount === '1000000')).toBe(true);
    expect(purchase.note).toBe('Heladera');
    expect((await listOf(s, card.id)).items.map((item) => item.id)).toEqual([purchase.id]);
    const found = await call(
      s.app,
      'get',
      `/credit-cards/${card.id}/installment-purchases/${purchase.id}`,
      s.ana,
    );
    expect(found.status).toBe(200);
  });

  it('answers 400 for 1 and for 61 installments and stores nothing (AC-02, invalid input)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    for (const installments of [1, 61, 0]) {
      const response = await post(s, card.id, purchaseBody(categoryId, { installments }));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await countPurchases(s.anaId)).toBe(0);
  });

  it('answers 400 for USD, an amount below the count and an unknown key and stores nothing (AC-03, invalid input)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    for (const overrides of [{ currency: 'USD' }, { amount: '5' }, { accountId: card.id }]) {
      const response = await post(s, card.id, purchaseBody(categoryId, overrides));
      expect(response.status).toBe(400);
    }
    expect(await countPurchases(s.anaId)).toBe(0);
  });

  it('splits 100.00 ARS in 3 into 33.34, 33.33 and 33.33 (AC-04)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const purchase = await record(
      s,
      card.id,
      purchaseBody(categoryId, { amount: '10000', installments: 3 }),
    );

    expect(purchase.installments.map((i) => i.amount)).toEqual(['3334', '3333', '3333']);
  });

  it('reads the installments in the statements closing 2026-10-24, 2026-11-24 and 2026-12-24 (AC-05)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const purchase = await record(
      s,
      card.id,
      purchaseBody(categoryId, { amount: '30000', installments: 3 }),
    );

    expect(purchase.installments.map((i) => i.closingDate)).toEqual([
      '2026-10-24',
      '2026-11-24',
      '2026-12-24',
    ]);
    const statements = await statementsOf(s, card.id);
    const [october] = statements;
    expect(october?.installments).toEqual([
      expect.objectContaining({ purchaseId: purchase.id, number: 1, count: 3, amount: '10000' }),
    ]);
  });

  it('answers 400 for a future date, 409 for an archived category, 400 for an income category and 404 for a foreign one (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const archived = await newCategory(connection.pool, s.anaId, 'expense', true);
    const income = await newCategory(connection.pool, s.anaId, 'income');
    const foreign = await newCategory(connection.pool, s.bobId, 'expense');

    const future = await post(s, card.id, purchaseBody(categoryId, { purchasedOn: '2026-10-07' }));
    const archivedResponse = await post(s, card.id, purchaseBody(archived));
    const incomeResponse = await post(s, card.id, purchaseBody(income));
    const foreignResponse = await post(s, card.id, purchaseBody(foreign));

    expect(future.status).toBe(400);
    expect(future.body).toMatchObject({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    expect(archivedResponse.status).toBe(409);
    expect(archivedResponse.body).toMatchObject({ code: 'CATEGORY_ARCHIVED' });
    expect(incomeResponse.status).toBe(400);
    expect(incomeResponse.body).toMatchObject({ code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' });
    expect(foreignResponse.status).toBe(404);
    expect(await countPurchases(s.anaId)).toBe(0);
  });

  it('answers 429 RATE_LIMITED on the 61st creation of a minute (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const body = purchaseBody(categoryId, { amount: '1000', installments: 2 });
    for (let i = 0; i < 60; i += 1) {
      expect((await post(s, card.id, body)).status).toBe(201);
    }

    const limited = await post(s, card.id, body);

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ code: 'RATE_LIMITED' });
    expect(await countPurchases(s.anaId)).toBe(60);
  });

  it('answers 401 without a session and 403 before the email is verified (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const anonymous = await call(
      s.app,
      'post',
      `/credit-cards/${card.id}/installment-purchases`,
      undefined,
      purchaseBody(categoryId),
    );
    const unverified = await post(s, card.id, purchaseBody(categoryId), s.eve);

    expect(anonymous.status).toBe(401);
    expect(unverified.status).toBe(403);
    expect(unverified.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('logs ids only: never the amount or the note', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    await record(
      s,
      card.id,
      purchaseBody(categoryId, { amount: '1234568', note: 'secret fridge' }),
    );

    const logged = s.lines.join('\n');
    expect(logged).toContain(card.id);
    expect(logged).not.toContain('1234568');
    expect(logged).not.toContain('secret fridge');
  });
});

describe('statement totals, pending debt and monthly expenses', () => {
  it('counts only the installment of November 2026 for its category: 10,000.00 ARS (AC-06)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await record(s, card.id, purchaseBody(categoryId));

    const response = await call(
      s.app,
      'get',
      '/credit-cards/installment-expenses?from=2026-11&to=2026-11',
      s.ana,
    );

    expect(response.status).toBe(200);
    expect(installmentExpensesResponseSchema.parse(response.body).items).toEqual([
      { month: '2026-11', categoryId, currency: 'ARS', amount: '1000000' },
    ]);
    const october = await call(
      s.app,
      'get',
      '/credit-cards/installment-expenses?from=2026-10&to=2026-10',
      s.ana,
    );
    expect(october.body).toEqual({ items: [] });
  });

  it('answers 400 for a malformed or inverted range (invalid input)', async () => {
    const s = await setup();

    for (const query of ['from=2026-11', 'from=2026-12&to=2026-11', 'from=2026-13&to=2026-14']) {
      const response = await call(
        s.app,
        'get',
        `/credit-cards/installment-expenses?${query}`,
        s.ana,
      );
      expect(response.status).toBe(400);
    }
  });

  it('reads totals of 60,000.00 ARS and 20.00 USD for purchases plus an installment (AC-07)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const expense = (currency: string, amount: string) =>
      call(s.app, 'post', `/credit-cards/${card.id}/expenses`, s.ana, {
        currency,
        categoryId,
        amount,
        occurredAt: '2026-10-06T14:00:00.000Z',
        rate: { source: 'manual', value: '14000000' },
      });
    expect((await expense('ARS', '5000000')).status).toBe(201);
    expect((await expense('USD', '2000')).status).toBe(201);
    await record(s, card.id, purchaseBody(categoryId));

    const [october] = await statementsOf(s, card.id);

    expect(october?.totals).toEqual({ ARS: '6000000', USD: '2000' });
  });

  it('shows a pending debt of 110,000.00 ARS once the first statement closed (AC-08)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await record(s, card.id, purchaseBody(categoryId));
    expect((await listOf(s, card.id)).pendingDebt).toEqual({ ARS: '12000000', USD: '0' });

    s.clock.current = new Date('2026-10-25T15:00:00.000Z');

    expect((await listOf(s, card.id)).pendingDebt).toEqual({ ARS: '11000000', USD: '0' });
  });
});

describe('DELETE and PATCH /credit-cards/:id/installment-purchases/:purchaseId', () => {
  it('removes the 10 open installments and keeps the 2 of closed statements (AC-09)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const purchase = await record(s, card.id, purchaseBody(categoryId));
    s.clock.current = new Date('2026-11-25T15:00:00.000Z');

    const response = await call(
      s.app,
      'delete',
      `/credit-cards/${card.id}/installment-purchases/${purchase.id}`,
      s.ana,
    );

    expect(response.status).toBe(204);
    const kept = await connection.pool.query<{ number: number }>(
      'select number from installments where purchase_id = $1 order by number',
      [purchase.id],
    );
    expect(kept.rows.map((row) => row.number)).toEqual([1, 2]);
    expect((await listOf(s, card.id)).items).toEqual([]);
    const statements = await statementsOf(s, card.id);
    expect(statements.find((st) => st.period === '2026-11')?.totals.ARS).toBe('1000000');
    const again = await call(
      s.app,
      'delete',
      `/credit-cards/${card.id}/installment-purchases/${purchase.id}`,
      s.ana,
    );
    expect(again.status).toBe(404);
  });

  it('edits the category and the note and keeps the amounts (FR-09)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const other = await newCategory(connection.pool, s.anaId, 'expense');
    const purchase = await record(s, card.id, purchaseBody(categoryId));

    const response = await call(
      s.app,
      'patch',
      `/credit-cards/${card.id}/installment-purchases/${purchase.id}`,
      s.ana,
      { categoryId: other, note: 'Nuevo' },
    );

    expect(response.status).toBe(200);
    const updated = installmentPurchaseResponseSchema.parse(response.body);
    expect(updated.categoryId).toBe(other);
    expect(updated.note).toBe('Nuevo');
    expect(updated.amount).toBe('12000000');
  });

  it('answers 400 to an empty edit, to an amount edit and to an income category (invalid input)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const income = await newCategory(connection.pool, s.anaId, 'income');
    const purchase = await record(s, card.id, purchaseBody(categoryId));
    const path = `/credit-cards/${card.id}/installment-purchases/${purchase.id}`;

    expect((await call(s.app, 'patch', path, s.ana, {})).status).toBe(400);
    expect((await call(s.app, 'patch', path, s.ana, { amount: '5000' })).status).toBe(400);
    const kind = await call(s.app, 'patch', path, s.ana, { categoryId: income });
    expect(kind.status).toBe(400);
    expect(kind.body).toMatchObject({ code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' });
  });

  it('answers 404 to Bob for get, edit, delete and list and changes nothing (AC-10)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const purchase = await record(s, card.id, purchaseBody(categoryId));
    const path = `/credit-cards/${card.id}/installment-purchases/${purchase.id}`;

    const responses = await Promise.all([
      call(s.app, 'get', path, s.bob),
      call(s.app, 'patch', path, s.bob, { note: 'hacked' }),
      call(s.app, 'delete', path, s.bob),
      call(s.app, 'get', `/credit-cards/${card.id}/installment-purchases`, s.bob),
      post(s, card.id, purchaseBody(categoryId), s.bob),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    const [stored] = (await listOf(s, card.id)).items;
    expect(stored?.note).toBeNull();
    expect(stored?.installments).toHaveLength(12);
    expect(await countPurchases(s.bobId)).toBe(0);
  });
});

describe('references to installment purchases', () => {
  it('answers 409 CARD_HAS_MOVEMENTS when deleting a card with purchases (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await record(s, card.id, purchaseBody(categoryId));

    const response = await call(s.app, 'delete', `/credit-cards/${card.id}`, s.ana);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CARD_HAS_MOVEMENTS' });
  });

  it('answers 409 CATEGORY_IN_USE when deleting a category an installment purchase uses (sad path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await record(s, card.id, purchaseBody(categoryId));

    const response = await call(s.app, 'delete', `/categories/${categoryId}`, s.ana);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CATEGORY_IN_USE' });
  });
});
