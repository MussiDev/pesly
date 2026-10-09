import {
  creditCardResponseSchema,
  listInstallmentPurchasesResponseSchema,
  statementImportResponseSchema,
  STATEMENT_IMPORT_MAX_LINES,
  type CreditCardResponse,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createCategoryRoutes } from '../../src/categories';
import {
  createCardAccountLinks,
  createCreditCardRoutes,
  createInstallmentCategoryUsage,
} from '../../src/credit-cards';
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

beforeEach(async () => {
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 12900000, 13000000, now(), now())
     on conflict (rate_type) do update set buy = excluded.buy, sell = excluded.sell, fetched_at = now()`,
  );
});

const PASSWORD = 'a long enough passphrase';
let sequence = 0;

/** Today is 2026-10-06 in America/Cordoba (UTC-3) at 12:00. */
class FixedClock {
  now(): Date {
    return new Date('2026-10-06T15:00:00.000Z');
  }
}

async function setup() {
  sequence += 1;
  const logger = createLogger({ level: 'debug', destination: { write: () => undefined } });
  const clock = new FixedClock();
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
  const anaEmail = `ana-${sequence}@statement-import.test`;
  const bobEmail = `bob-${sequence}@statement-import.test`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  return { app: harness.app, anaId, ana, bob };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function call(
  app: Express,
  method: 'get' | 'post',
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
) {
  const req = request(app)[method](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return method === 'get' ? req : req.send(body);
}

async function cardWithCategory(s: Setup) {
  const created = await call(s.app, 'post', '/credit-cards', s.ana, {
    name: 'Visa',
    closingDay: 24,
    dueDay: 5,
  });
  expect(created.status).toBe(201);
  const card: CreditCardResponse = creditCardResponseSchema.parse(created.body);
  return { card, categoryId: await newCategory(connection.pool, s.anaId, 'expense') };
}

const line = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-09-10',
  description: 'Tienda de ejemplo',
  voucher: '000111*',
  currency: 'ARS',
  amount: '123456',
  installmentNumber: null,
  installmentCount: null,
  kind: 'purchase',
  ...overrides,
});

const body = (categoryId: string, lines: Record<string, unknown>[], extra = {}) => ({
  closingDate: '2026-09-24',
  dueDate: '2026-10-05',
  categoryId,
  lines,
  ...extra,
});

const importOf = (s: Setup, cardId: string, payload: Record<string, unknown>, cookies = s.ana) =>
  call(s.app, 'post', `/credit-cards/${cardId}/statement-imports`, cookies, payload);

async function count(table: string, ownerId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where owner_id = $1`,
    [ownerId],
  );
  return Number(result.rows[0]?.n);
}

describe('POST /credit-cards/:id/statement-imports', () => {
  it('creates expenses and an installment purchase anchored on the imported statement (happy path)', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const response = await importOf(
      s,
      card.id,
      body(categoryId, [
        line(),
        line({ description: 'Servicio', currency: 'USD', amount: '2000', voucher: null }),
        line({
          description: 'Heladera',
          date: '2026-04-30',
          amount: '733997',
          installmentNumber: 5,
          installmentCount: 6,
        }),
        line({ description: 'Impuesto de sellos', kind: 'fee', amount: '1167', voucher: null }),
      ]),
    );

    expect(response.status).toBe(201);
    expect(statementImportResponseSchema.parse(response.body)).toEqual({
      created: 4,
      skipped: 0,
      createdExpenses: 3,
      createdInstallmentPurchases: 1,
    });
    expect(await count('movements', s.anaId)).toBe(3);
    const purchases = listInstallmentPurchasesResponseSchema.parse(
      (await call(s.app, 'get', `/credit-cards/${card.id}/installment-purchases`, s.ana)).body,
    ).items;
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ amount: String(733997n * 6n), installmentCount: 6 });
    expect(purchases[0]?.installments.find((i) => i.number === 5)).toMatchObject({
      period: '2026-09',
      closingDate: '2026-09-24',
      amount: '733997',
    });
    const notes = await connection.pool.query<{ note: string }>(
      'select note from movements where owner_id = $1 order by note',
      [s.anaId],
    );
    expect(notes.rows.map((row) => row.note)).toContain('Tienda de ejemplo');
  });

  it('puts the imported lines in the imported statement, created when the card has no earlier one', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    await importOf(s, card.id, body(categoryId, [line()]));

    const statements = await call(s.app, 'get', `/credit-cards/${card.id}/statements`, s.ana);
    const items = (statements.body as { items: { period: string; totals: { ARS: string } }[] })
      .items;
    expect(items.find((item) => item.period === '2026-09')?.totals.ARS).toBe('123456');
  });

  it('skips every line on a second import of the same file and creates nothing twice', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const payload = body(categoryId, [
      line(),
      line({ installmentNumber: 1, installmentCount: 3, description: 'Cuotas' }),
    ]);

    await importOf(s, card.id, payload);
    const again = await importOf(s, card.id, payload);

    expect(again.body).toEqual({
      created: 0,
      skipped: 2,
      createdExpenses: 0,
      createdInstallmentPurchases: 0,
    });
    expect(await count('movements', s.anaId)).toBe(1);
    expect(await count('installment_purchases', s.anaId)).toBe(1);
    expect(await count('card_statement_import_lines', s.anaId)).toBe(2);
  });

  it('keeps identical repeated lines of one file as separate expenses', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const response = await importOf(s, card.id, body(categoryId, [line(), line(), line()]));

    expect(response.body).toMatchObject({ created: 3, skipped: 0 });
    expect(await count('movements', s.anaId)).toBe(3);
  });

  it('answers 404 for another user, and stores nothing', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const response = await importOf(s, card.id, body(categoryId, [line()]), s.bob);

    expect(response.status).toBe(404);
    expect(await count('movements', s.anaId)).toBe(0);
    expect(await count('card_statement_import_lines', s.anaId)).toBe(0);
  });

  it('answers 404 for a card that does not exist', async () => {
    const s = await setup();
    const { categoryId } = await cardWithCategory(s);

    const response = await importOf(
      s,
      '00000000-0000-4000-8000-000000000000',
      body(categoryId, [line()]),
    );

    expect(response.status).toBe(404);
  });

  it('rejects an income category and an archived one, and stores nothing', async () => {
    const s = await setup();
    const { card } = await cardWithCategory(s);
    const income = await newCategory(connection.pool, s.anaId, 'income');
    const archived = await newCategory(connection.pool, s.anaId, 'expense', true);

    const asIncome = await importOf(s, card.id, body(income, [line()]));
    const asArchived = await importOf(s, card.id, body(archived, [line()]));

    expect(asIncome.status).toBe(400);
    expect(asIncome.body).toMatchObject({ code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' });
    expect(asArchived.status).toBe(409);
    expect(await count('card_statement_import_lines', s.anaId)).toBe(0);
  });

  it('answers 400 for more than 300 lines, for no lines and for a malformed line', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);

    const tooMany = Array.from({ length: STATEMENT_IMPORT_MAX_LINES + 1 }, () => line());
    for (const lines of [tooMany, [], [line({ amount: '12.5' })], [line({ kind: 'payment' })]]) {
      const response = await importOf(s, card.id, body(categoryId, lines));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await count('movements', s.anaId)).toBe(0);
  });

  it('imports 300 lines in one request, spending one unit of the creation limit', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const lines = Array.from({ length: STATEMENT_IMPORT_MAX_LINES }, (_, index) =>
      line({ amount: String(1000 + index) }),
    );

    const response = await importOf(s, card.id, body(categoryId, lines));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ created: 300 });
    const units = await connection.pool.query<{ count: string }>(
      `select sum(count) as count from movement_rate_limits where owner_id = $1 and bucket = 'manual'`,
      [s.anaId],
    );
    expect(Number(units.rows[0]?.count)).toBe(1);
    // A single creation right after is still within the budget of 60.
    const single = await call(
      s.app,
      'post',
      `/credit-cards/${card.id}/installment-purchases`,
      s.ana,
      {
        currency: 'ARS',
        categoryId,
        amount: '1000',
        installments: 2,
        purchasedOn: '2026-10-06',
      },
    );
    expect(single.status).toBe(201);
  });

  it('answers 429 once the creation budget is spent, and creates nothing', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    for (let i = 0; i < 60; i += 1) {
      const created = await call(
        s.app,
        'post',
        `/credit-cards/${card.id}/installment-purchases`,
        s.ana,
        { currency: 'ARS', categoryId, amount: '1000', installments: 2, purchasedOn: '2026-10-06' },
      );
      expect(created.status).toBe(201);
    }

    const limited = await importOf(s, card.id, body(categoryId, [line()]));

    expect(limited.status).toBe(429);
    expect(await count('card_statement_import_lines', s.anaId)).toBe(0);
  });

  it('answers 401 without a session', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    const response = await call(
      s.app,
      'post',
      `/credit-cards/${card.id}/statement-imports`,
      undefined,
      body(categoryId, [line()]),
    );
    expect(response.status).toBe(401);
  });

  it('removes the fingerprints with the card', async () => {
    const s = await setup();
    const { card, categoryId } = await cardWithCategory(s);
    await importOf(
      s,
      card.id,
      body(categoryId, [line({ installmentNumber: 1, installmentCount: 2 })]),
    );
    await connection.pool.query('delete from installment_purchases where owner_id = $1', [s.anaId]);

    await connection.pool.query('delete from credit_cards where id = $1', [card.id]);

    expect(await count('card_statement_import_lines', s.anaId)).toBe(0);
  });
});
