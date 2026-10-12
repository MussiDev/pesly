import type {
  ExpensesByCategoryResponse,
  IncomeExpensesResponse,
  NetWorthResponse,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReportRoutes } from '../../src/reports';
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
import { linkTag, newAccount, newCategory, newTag } from '../movements/db-fixtures';
import { FixedClock } from './fakes';
import {
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
} from './flow-fixtures';
import { installmentPurchaseOf, portfolioOf, snapshotOf } from './net-worth-fixtures';

const PASSWORD = 'a long enough passphrase';
const RANGE = 'from=2026-09-01&to=2026-10-06';

let connection: DatabaseConnection;
let app: Express;
let sequence = 0;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
  // No `useCases`: the default composition of the module is what is under test.
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createReportRoutes({ db: connection.db, logger, clock: new FixedClock() })],
  });
  app = harness.app;
});

afterAll(async () => {
  await connection.pool.end();
});

interface Person {
  id: string;
  cookies: SessionCookies;
  ars: string;
  usd: string;
  food: string;
  salary: string;
}

async function person(name: string): Promise<Person> {
  sequence += 1;
  const email = `${name}-${sequence}@reports-flow.test`;
  const id = await seedUser(connection, { email, password: PASSWORD });
  const cookies = sessionFrom(await signIn(app, email, PASSWORD));
  return {
    id,
    cookies,
    ars: await newAccount(connection.pool, id, false, 'ARS'),
    usd: await newAccount(connection.pool, id, false, 'USD'),
    food: await newCategory(connection.pool, id, 'expense'),
    salary: await newCategory(connection.pool, id, 'income'),
  };
}

async function read(
  path: string,
  cookies?: SessionCookies,
): Promise<{ status: number; body: unknown; text: string }> {
  const req = request(app).get(path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  const response = await req;
  return { status: response.status, body: response.body as unknown, text: response.text };
}

type Read = Awaited<ReturnType<typeof read>>;

/** The same read with the body typed as the report response the route validates it against. */
async function readCategories(
  path: string,
  cookies?: SessionCookies,
): Promise<Read & { body: ExpensesByCategoryResponse }> {
  const result = await read(path, cookies);
  return { ...result, body: result.body as ExpensesByCategoryResponse };
}

async function readFlows(
  path: string,
  cookies?: SessionCookies,
): Promise<Read & { body: IncomeExpensesResponse }> {
  const result = await read(path, cookies);
  return { ...result, body: result.body as IncomeExpensesResponse };
}

async function readNetWorth(
  path: string,
  cookies?: SessionCookies,
): Promise<Read & { body: NetWorthResponse }> {
  const result = await read(path, cookies);
  return { ...result, body: result.body as NetWorthResponse };
}

async function readError(
  path: string,
  cookies?: SessionCookies,
): Promise<Read & { body: { code?: string } }> {
  const result = await read(path, cookies);
  return { ...result, body: result.body as { code?: string } };
}

/** Ana and Bea share one group; each has her own movements, installments and snapshots. */
async function twoUsers() {
  const ana = await person('ana');
  const bea = await person('bea');
  const { pool } = connection;
  const at = (p: Person, occurredAt: string) => ({ ownerId: p.id, occurredAt });

  await newMovementAt(pool, {
    ...at(ana, '2026-09-05T15:00:00Z'),
    accountId: ana.ars,
    categoryId: ana.salary,
    type: 'income',
    amount: 1_000_000n,
  });
  await newMovementAt(pool, {
    ...at(ana, '2026-09-20T15:00:00Z'),
    accountId: ana.ars,
    categoryId: ana.food,
    amount: 250_000n,
  });
  await newMovementAt(pool, {
    ...at(ana, '2026-10-03T15:00:00Z'),
    accountId: ana.ars,
    categoryId: ana.food,
    amount: 100_000n,
  });
  await newMovementAt(pool, {
    ...at(bea, '2026-09-10T15:00:00Z'),
    accountId: bea.ars,
    categoryId: bea.salary,
    type: 'income',
    amount: 5_000_000n,
  });
  await newMovementAt(pool, {
    ...at(bea, '2026-10-02T15:00:00Z'),
    accountId: bea.ars,
    categoryId: bea.food,
    amount: 700_000n,
  });

  // Bea paid 100,000 for both: Ana's share is 40,000 and Bea's is 60,000.
  const group = await newGroup(pool);
  const anaMember = await newMember(pool, group, ana.id);
  const beaMember = await newMember(pool, group, bea.id);
  const groupCategory = await newGroupCategory(pool, group, { name: 'Zzz unmatched' });
  await newGroupExpense(pool, {
    groupId: group,
    payerMemberId: beaMember,
    categoryId: groupCategory,
    amount: 100_000n,
    occurredAt: '2026-10-02T15:00:00Z',
    shares: [
      { memberId: anaMember, amount: 40_000n },
      { memberId: beaMember, amount: 60_000n },
    ],
  });

  const statements = (due: string) => [
    { period: '2026-09', closingDate: '2026-09-20', dueDate: due },
    { period: '2026-10', closingDate: '2026-10-20', dueDate: '2026-11-05' },
  ];
  await installmentPurchaseOf(pool, {
    ownerId: ana.id,
    categoryId: ana.food,
    purchasedOn: '2026-09-01',
    firstPeriod: '2026-09',
    count: 2,
    each: 5_000n,
    statements: statements('2026-10-05'),
  });
  await installmentPurchaseOf(pool, {
    ownerId: bea.id,
    categoryId: bea.food,
    purchasedOn: '2026-09-01',
    firstPeriod: '2026-09',
    count: 3,
    each: 9_000n,
    statements: statements('2026-10-04'),
  });

  await snapshotOf(pool, {
    portfolioId: await portfolioOf(pool, ana.id, '2026-01-01T00:00:00Z'),
    ownerId: ana.id,
    date: '2026-09-30',
    value: 123_000n,
  });
  await snapshotOf(pool, {
    portfolioId: await portfolioOf(pool, bea.id, '2026-01-01T00:00:00Z'),
    ownerId: bea.id,
    date: '2026-09-30',
    value: 999_000_000n,
  });
  await pool.query(
    `insert into exchange_rate_history (rate_type, rate_date, buy, sell, recorded_at)
     values ('mep', '2026-09-30', 13000000, 13000000, now())`,
  );
  await pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 14000000, 14000000, now(), now())`,
  );
  return { ana, bea };
}

describe('the three reports through HTTP with two users', () => {
  it('return only the caller figures for expenses by category (AC-46)', async () => {
    const { ana, bea } = await twoUsers();

    const forAna = await readCategories(`/reports/expenses-by-category?${RANGE}`, ana.cookies);
    const forBea = await readCategories(`/reports/expenses-by-category?${RANGE}`, bea.cookies);

    expect(forAna.status).toBe(200);
    // 250,000 + 100,000 (movements) + 5,000 (installment due 2026-10-05) + 40,000 (share).
    expect(forAna.body.total).toBe('395000');
    expect(forAna.body.categories).toEqual([
      {
        categoryId: ana.food,
        name: expect.any(String) as string,
        defaultKey: null,
        amount: '355000',
      },
      { categoryId: null, name: null, defaultKey: null, amount: '40000' },
    ]);
    expect(forBea.body.total).toBe('769000');
    expect(forBea.body.categories.map((c) => c.categoryId)).toEqual([bea.food, null]);
  });

  it('return only the caller months for income and expenses (AC-46)', async () => {
    const { ana, bea } = await twoUsers();

    const forAna = await readFlows(`/reports/income-expenses?${RANGE}`, ana.cookies);
    const forBea = await readFlows(`/reports/income-expenses?${RANGE}`, bea.cookies);

    expect(forAna.body.months).toEqual([
      { month: '2026-09', income: '1000000', expenses: '250000' },
      { month: '2026-10', income: '0', expenses: '145000' },
    ]);
    expect(forBea.body.months).toEqual([
      { month: '2026-09', income: '5000000', expenses: '0' },
      { month: '2026-10', income: '0', expenses: '769000' },
    ]);
  });

  it('return only the caller snapshots, accounts, shares and installments in net worth (AC-46)', async () => {
    const { ana, bea } = await twoUsers();

    const forAna = await readNetWorth(
      '/reports/net-worth?from=2026-09-01&to=2026-10-06',
      ana.cookies,
    );
    const forBea = await readNetWorth(
      '/reports/net-worth?from=2026-09-01&to=2026-10-06',
      bea.cookies,
    );

    expect(forAna.status).toBe(200);
    const last = forAna.body.points[forAna.body.points.length - 1];
    // 650,000 accounts + 123,000 snapshot - 40,000 owed in the group - 5,000 installment still ahead.
    expect(last).toMatchObject({ date: '2026-10-06', ars: '728000', usd: '0', total: '728000' });
    expect(forAna.text).not.toContain('999000000');
    const beaLast = forBea.body.points[forBea.body.points.length - 1];
    expect(BigInt(beaLast?.ars ?? '0')).toBeGreaterThan(900_000_000n);
  });

  it('shows a group member only their own share, never an amount of another member (AC-44)', async () => {
    const { ana, bea } = await twoUsers();

    const flows = await readFlows(`/reports/income-expenses?${RANGE}`, ana.cookies);
    const categories = await readCategories(`/reports/expenses-by-category?${RANGE}`, ana.cookies);
    const beaFlows = await readFlows(`/reports/income-expenses?${RANGE}`, bea.cookies);

    // Ana sees 40,000 of the 100,000; the 60,000 of Bea and the full 100,000 never appear.
    expect(categories.body.categories.find((c) => c.categoryId === null)?.amount).toBe('40000');
    expect(flows.text).not.toMatch(/"(60000|100000|769000)"/);
    expect(categories.text).not.toMatch(/"(60000|100000|769000)"/);
    expect(beaFlows.body.months[1]?.expenses).toBe('769000');
  });
});

describe('the ownership and session checks through the real routes', () => {
  it('answers 404 for an account or a tag of another user, and 401 with no session (AC-43, AC-45)', async () => {
    const { ana, bea } = await twoUsers();
    const tag = await newTag(connection.pool, bea.id, 'only-bea');
    const movement = await newMovementAt(connection.pool, {
      ownerId: bea.id,
      accountId: bea.ars,
      categoryId: bea.food,
      amount: 10n,
      occurredAt: '2026-10-01T15:00:00Z',
    });
    await linkTag(connection.pool, {
      movementId: movement,
      tagId: tag,
      ownerId: bea.id,
      position: 0,
    });

    for (const report of ['expenses-by-category', 'income-expenses']) {
      const account = await read(`/reports/${report}?accountId=${bea.ars}`, ana.cookies);
      const foreignTag = await read(`/reports/${report}?tag=only-bea`, ana.cookies);
      expect(account.status, report).toBe(404);
      expect(foreignTag.status, report).toBe(404);
      expect(account.text).not.toContain('700000');
    }
    for (const path of [
      '/reports/expenses-by-category',
      '/reports/income-expenses',
      '/reports/net-worth',
    ]) {
      const anonymous = await read(`${path}?${RANGE}`);
      expect(anonymous.status, path).toBe(401);
      expect(anonymous.text).not.toMatch(/\d{5,}/);
    }
  });

  it('keeps a frozen-rate expense unchanged after the stored rates and history change (AC-16)', async () => {
    const cora = await person('cora');
    const { pool } = connection;
    // 20.00 USD frozen at 1,400.0000 ARS per USD: 2,800.00 ARS.
    await newMovementAt(pool, {
      ownerId: cora.id,
      accountId: cora.usd,
      categoryId: cora.food,
      amount: 2000n,
      occurredAt: '2026-10-04T15:00:00Z',
      rate: 14_000_000n,
    });
    await pool.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ('mep', 14000000, 14000000, now(), now())`,
    );
    const paths = [`/reports/expenses-by-category?${RANGE}`, `/reports/income-expenses?${RANGE}`];
    const before = await Promise.all(paths.map((path) => read(path, cora.cookies)));
    expect(before[0]?.status).toBe(200);
    expect((before[0]?.body as ExpensesByCategoryResponse).total).toBe('2800000');

    await pool.query('update exchange_rates set buy = 99000000, sell = 99000000');
    await pool.query(
      `insert into exchange_rate_history (rate_type, rate_date, buy, sell, recorded_at)
       values ('mep', '2026-10-04', 1, 1, now())`,
    );
    const after = await Promise.all(paths.map((path) => read(path, cora.cookies)));

    expect(after.map((r) => r.body)).toEqual(before.map((r) => r.body));
  });

  it('sends a bad range and an unknown filter to the error middleware without a stack or SQL (FR-16)', async () => {
    const ana = await person('ana-bad');
    const queries = [
      'from=2026-10-05&to=2026-10-01',
      'from=2026-02-30&to=2026-10-01',
      'from=2024-01-01&to=2026-10-01',
      'from=2026-09-01&to=2027-01-01',
      'unknown=1',
    ];
    const paths = ['expenses-by-category', 'income-expenses', 'net-worth'];
    for (const path of paths) {
      for (const query of queries) {
        const response = await readError(`/reports/${path}?${query}`, ana.cookies);
        expect(response.status, `${path}?${query}`).toBe(400);
        expect(response.body.code).toBe('VALIDATION_FAILED');
        expect(response.text).not.toMatch(/at .*\.ts|select |insert |from "|stack/i);
      }
    }
    const filter = await readError('/reports/income-expenses?accountId=not-a-uuid', ana.cookies);
    expect(filter.status).toBe(400);
    expect(filter.body.code).toBe('VALIDATION_FAILED');
  });
});
