import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount } from '../movements/db-fixtures';
import { addUser, buildApp, get, type Owner } from './route-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PATHS = [
  '/reports/expenses-by-category',
  '/reports/income-expenses',
  '/reports/net-worth',
] as const;

async function setup() {
  const built = buildApp(connection);
  const ana = await addUser(connection, built.app, 'ana');
  const bea = await addUser(connection, built.app, 'bea');
  return { ...built, ana, bea };
}

async function newTag(owner: Owner, name: string): Promise<void> {
  await connection.pool.query('insert into tags (owner_id, name) values ($1, $2)', [
    owner.id,
    name,
  ]);
}

describe('report routes', () => {
  it('answer 200 with a valid body for a verified session', async () => {
    const { app, ana, calls } = await setup();

    for (const path of PATHS) {
      expect((await get(app, path, ana.cookies)).status).toBe(200);
    }
    expect(calls).toEqual({ expensesByCategory: 1, incomeExpenses: 1, netWorth: 1 });
  });

  it('answer 401 with no session and call no use case', async () => {
    const { app, calls } = await setup();

    for (const path of PATHS) {
      expect((await get(app, path)).status).toBe(401);
    }
    expect(calls).toEqual({ expensesByCategory: 0, incomeExpenses: 0, netWorth: 0 });
  });

  it('answer 403 for an unverified email', async () => {
    const built = buildApp(connection);
    const eve = await addUser(connection, built.app, 'eve', { verified: false });

    for (const path of PATHS) {
      const response = await get(built.app, path, eve.cookies);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    }
    expect(built.calls.netWorth).toBe(0);
  });

  it('refuse 25 months on category and net worth and 13 on income and expenses', async () => {
    const { app, ana } = await setup();

    const category = await get(
      app,
      '/reports/expenses-by-category?from=2024-10-01&to=2026-10-06',
      ana.cookies,
    );
    const netWorth = await get(
      app,
      '/reports/net-worth?from=2024-10-01&to=2026-10-06',
      ana.cookies,
    );
    const flows = await get(
      app,
      '/reports/income-expenses?from=2025-10-01&to=2026-10-06',
      ana.cookies,
    );

    expect(category.status).toBe(400);
    expect(category.body.details).toEqual({ maxMonths: '24' });
    expect(netWorth.status).toBe(400);
    expect(netWorth.body.details).toEqual({ maxMonths: '24' });
    expect(flows.status).toBe(400);
    expect(flows.body.details).toEqual({ maxMonths: '12' });
  });

  it('accept exactly the limit', async () => {
    const { app, ana } = await setup();

    expect(
      (await get(app, '/reports/income-expenses?from=2025-11-01&to=2026-10-06', ana.cookies))
        .status,
    ).toBe(200);
    expect(
      (await get(app, '/reports/net-worth?from=2024-11-01&to=2026-10-06', ana.cookies)).status,
    ).toBe(200);
  });

  it('refuse a malformed date, from after to and to after today; accept to equal to today', async () => {
    const { app, ana } = await setup();
    const bad = ['from=2026-13-01', 'from=nope', 'from=2026-05-02&to=2026-05-01', 'to=2026-10-07'];

    for (const query of bad) {
      const response = await get(app, `/reports/income-expenses?${query}`, ana.cookies);
      expect(response.status, query).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    }
    expect((await get(app, '/reports/income-expenses?to=2026-10-06', ana.cookies)).status).toBe(
      200,
    );
  });

  it('answer the same 404 for a foreign and an unknown account', async () => {
    const { app, ana, bea } = await setup();
    const hers = await newAccount(connection.pool, bea.id);

    const foreign = await get(app, `/reports/income-expenses?accountId=${hers}`, ana.cookies);
    const unknown = await get(
      app,
      '/reports/income-expenses?accountId=00000000-0000-4000-8000-000000000000',
      ana.cookies,
    );

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
  });

  it('answer 404 for the tag of another user and for an unknown tag', async () => {
    const { app, ana, bea } = await setup();
    await newTag(bea, 'only-bea');

    expect((await get(app, '/reports/income-expenses?tag=only-bea', ana.cookies)).status).toBe(404);
    expect((await get(app, '/reports/income-expenses?tag=unknown', ana.cookies)).status).toBe(404);
  });

  it('match the tag Vacations2026 to the stored vacations2026 and an NFC-equivalent spelling', async () => {
    const { app, ana } = await setup();
    await newTag(ana, 'vacations2026');
    await newTag(ana, 'café');

    expect(
      (await get(app, '/reports/income-expenses?tag=Vacations2026', ana.cookies)).status,
    ).toBe(200);
    expect(
      (await get(app, '/reports/expenses-by-category?tag=cafe%CC%81', ana.cookies)).status,
    ).toBe(200);
  });

  it('refuse accountId and tag on net worth', async () => {
    const { app, ana } = await setup();
    const account = await newAccount(connection.pool, ana.id);

    const withAccount = await get(app, `/reports/net-worth?accountId=${account}`, ana.cookies);
    const withTag = await get(app, '/reports/net-worth?tag=x', ana.cookies);

    expect(withAccount.status).toBe(400);
    expect(withTag.status).toBe(400);
  });
});
