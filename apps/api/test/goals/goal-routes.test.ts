import {
  goalResponseSchema,
  listGoalEntriesResponseSchema,
  listGoalsResponseSchema,
  recordGoalEntryResponseSchema,
  type GoalResponse,
} from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newMovement } from '../movements/db-fixtures';
import { call, createAccount, goalsSetup, type GoalsSetup, type Owner } from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const vacations = (over: Record<string, unknown> = {}) => ({
  name: 'Vacations',
  targetAmount: '200000',
  currency: 'USD',
  targetDate: '2026-12-31',
  ...over,
});

async function createGoal(
  s: GoalsSetup,
  owner: Owner,
  body: Record<string, unknown> = vacations(),
): Promise<GoalResponse> {
  const response = await call(s.app, 'post', '/goals', owner.cookies, body);
  expect(response.status).toBe(201);
  return goalResponseSchema.parse(response.body);
}

const getGoal = async (s: GoalsSetup, owner: Owner, id: string) => {
  const response = await call(s.app, 'get', `/goals/${id}`, owner.cookies);
  expect(response.status).toBe(200);
  return goalResponseSchema.parse(response.body);
};

describe('POST /goals, GET /goals, GET /goals/:id', () => {
  it('creates, lists and reads a goal with derived fields (AC-01, AC-09, AC-10)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');

    const created = await createGoal(s, ana);
    expect(created).toMatchObject({
      name: 'Vacations',
      targetAmount: '200000',
      currency: 'USD',
      targetDate: '2026-12-31',
      accountId: null,
      progress: '0',
      percentage: 0,
      status: 'active',
      // 2,000.00 over October, November and December.
      monthlyAmountNeeded: '66667',
    });

    const listed = listGoalsResponseSchema.parse(
      (await call(s.app, 'get', '/goals', ana.cookies)).body,
    );
    expect(listed.goals.map((goal) => goal.id)).toEqual([created.id]);

    const entry = await call(s.app, 'post', `/goals/${created.id}/entries`, ana.cookies, {
      kind: 'contribution',
      amount: '50000',
    });
    expect(entry.status).toBe(201);
    const read = await getGoal(s, ana, created.id);
    expect(read).toMatchObject({ progress: '50000', percentage: 25, monthlyAmountNeeded: '50000' });
  });

  it('answers 400 to invalid create bodies (AC-02, AC-17)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    for (const body of [
      vacations({ targetAmount: '0' }),
      vacations({ targetAmount: '10.5' }),
      vacations({ name: '   ' }),
      vacations({ progress: '5' }),
      vacations({ targetDate: '2026-02-30' }),
      vacations({ currency: 'EUR' }),
    ]) {
      const response = await call(s.app, 'post', '/goals', ana.cookies, body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(
      listGoalsResponseSchema.parse((await call(s.app, 'get', '/goals', ana.cookies)).body).goals,
    ).toEqual([]);
  });

  it('requires a session and a verified email', async () => {
    const s = goalsSetup(connection);
    const eve = await s.addUser('eve', { verified: false });
    expect((await call(s.app, 'get', '/goals')).status).toBe(401);
    expect((await call(s.app, 'get', '/goals', eve.cookies)).status).toBe(403);
  });

  it('links to an account: another currency is 409, another user account is 404 (AC-03, AC-18)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const bob = await s.addUser('bob');
    const arsAccount = await createAccount(s, ana, 'ARS');
    const bobAccount = await createAccount(s, bob, 'USD');

    const mismatch = await call(
      s.app,
      'post',
      '/goals',
      ana.cookies,
      vacations({ accountId: arsAccount }),
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ code: 'GOAL_ACCOUNT_CURRENCY_MISMATCH' });

    const foreign = await call(
      s.app,
      'post',
      '/goals',
      ana.cookies,
      vacations({ accountId: bobAccount }),
    );
    expect(foreign.status).toBe(404);
    expect(
      listGoalsResponseSchema.parse((await call(s.app, 'get', '/goals', ana.cookies)).body).goals,
    ).toEqual([]);
  });
});

describe('entries', () => {
  it('contributes, withdraws, refuses an overdraw and a zero amount, and leaves accounts untouched (AC-05 to AC-07, AC-20)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const account = await createAccount(s, ana, 'USD', '90000');
    const goal = await createGoal(s, ana);
    const entries = (body: Record<string, unknown>) =>
      call(s.app, 'post', `/goals/${goal.id}/entries`, ana.cookies, body);

    const contribution = await entries({ kind: 'contribution', amount: '20000' });
    expect(contribution.status).toBe(201);
    const recorded = recordGoalEntryResponseSchema.parse(contribution.body);
    expect(recorded.entry).toMatchObject({ kind: 'contribution', amount: '20000' });
    expect(recorded.goal).toMatchObject({ progress: '20000', percentage: 10 });

    const withdrawal = recordGoalEntryResponseSchema.parse(
      (await entries({ kind: 'withdrawal', amount: '5000' })).body,
    );
    expect(withdrawal.goal.progress).toBe('15000');

    const overdraw = await entries({ kind: 'withdrawal', amount: '20000' });
    expect(overdraw.status).toBe(409);
    expect(overdraw.body).toMatchObject({ code: 'GOAL_WITHDRAWAL_EXCEEDS_PROGRESS' });
    expect((await getGoal(s, ana, goal.id)).progress).toBe('15000');

    for (const amount of ['0', '-5']) {
      const invalid = await entries({ kind: 'contribution', amount });
      expect(invalid.status).toBe(400);
    }
    expect((await entries({ kind: 'transfer', amount: '5' })).status).toBe(400);

    const listed = listGoalEntriesResponseSchema.parse(
      (await call(s.app, 'get', `/goals/${goal.id}/entries?limit=1`, ana.cookies)).body,
    );
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]).toMatchObject({ kind: 'withdrawal', amount: '5000' });
    expect(
      (await call(s.app, 'get', `/goals/${goal.id}/entries?limit=0`, ana.cookies)).status,
    ).toBe(400);

    const balance = await call(s.app, 'get', `/accounts/${account}`, ana.cookies);
    expect(balance.body).toMatchObject({ balance: '90000' });
  });

  it('shows a linked goal following its account and refuses its entries (AC-04, AC-19)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const account = await createAccount(s, ana, 'USD', '50000');
    const goal = await createGoal(s, ana, vacations({ accountId: account }));
    expect(goal).toMatchObject({ accountId: account, progress: '50000', percentage: 25 });

    const category = await newCategory(connection.pool, ana.id, 'income');
    await newMovement(connection.pool, {
      ownerId: ana.id,
      accountId: account,
      categoryId: category,
      type: 'income',
      amount: 20_000n,
    });
    expect((await getGoal(s, ana, goal.id)).progress).toBe('70000');

    for (const kind of ['contribution', 'withdrawal']) {
      const response = await call(s.app, 'post', `/goals/${goal.id}/entries`, ana.cookies, {
        kind,
        amount: '100',
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'GOAL_LINKED_TO_ACCOUNT' });
    }
  });
});

describe('time and edits', () => {
  it('reaches the target and becomes overdue after its date with a moved clock (AC-11, AC-12)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const goal = await createGoal(s, ana, vacations({ targetAmount: '10000' }));
    await call(s.app, 'post', `/goals/${goal.id}/entries`, ana.cookies, {
      kind: 'contribution',
      amount: '4000',
    });

    s.clock.current = new Date('2027-01-02T15:00:00.000Z');
    expect(await getGoal(s, ana, goal.id)).toMatchObject({
      status: 'overdue',
      monthlyAmountNeeded: null,
    });

    await call(s.app, 'post', `/goals/${goal.id}/entries`, ana.cookies, {
      kind: 'contribution',
      amount: '6000',
    });
    expect(await getGoal(s, ana, goal.id)).toMatchObject({
      status: 'reached',
      percentage: 100,
      monthlyAmountNeeded: null,
    });
  });

  it('edits and recomputes; an invalid edit answers 400 and changes nothing (AC-13, AC-22)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const goal = await createGoal(s, ana);
    await call(s.app, 'post', `/goals/${goal.id}/entries`, ana.cookies, {
      kind: 'contribution',
      amount: '50000',
    });

    const edited = await call(s.app, 'patch', `/goals/${goal.id}`, ana.cookies, {
      name: 'Trip',
      targetAmount: '100000',
      targetDate: null,
    });
    expect(edited.status).toBe(200);
    expect(goalResponseSchema.parse(edited.body)).toMatchObject({
      name: 'Trip',
      targetAmount: '100000',
      targetDate: null,
      percentage: 50,
      monthlyAmountNeeded: null,
    });

    for (const body of [{}, { name: '  ' }, { targetAmount: '0' }, { currency: 'ARS' }]) {
      expect((await call(s.app, 'patch', `/goals/${goal.id}`, ana.cookies, body)).status).toBe(400);
    }
    expect(await getGoal(s, ana, goal.id)).toMatchObject({ name: 'Trip', targetAmount: '100000' });
  });

  it('deletes with 204 and removes the goal and its entries, keeping the account (AC-14)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const account = await createAccount(s, ana, 'USD', '1000');
    const goal = await createGoal(s, ana);
    await call(s.app, 'post', `/goals/${goal.id}/entries`, ana.cookies, {
      kind: 'contribution',
      amount: '500',
    });

    expect((await call(s.app, 'delete', `/goals/${goal.id}`, ana.cookies)).status).toBe(204);
    expect((await call(s.app, 'get', `/goals/${goal.id}`, ana.cookies)).status).toBe(404);
    const left = await connection.pool.query(
      'select count(*)::int as n from goal_entries where goal_id = $1',
      [goal.id],
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
    expect((await call(s.app, 'get', `/accounts/${account}`, ana.cookies)).body).toMatchObject({
      balance: '1000',
    });
  });
});

describe('ownership and limits', () => {
  it('answers 404 with the same body for another user goal as for an unknown id (AC-15, AC-16)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const bob = await s.addUser('bob');
    const goal = await createGoal(s, ana);
    const unknown = '00000000-0000-4000-8000-000000000000';

    const attempts: [Parameters<typeof call>[1], string, Record<string, unknown>?][] = [
      ['get', `/goals/ID`],
      ['patch', `/goals/ID`, { name: 'Mine' }],
      ['delete', `/goals/ID`],
      ['post', `/goals/ID/entries`, { kind: 'contribution', amount: '5' }],
      ['get', `/goals/ID/entries`],
    ];
    for (const [method, path, body] of attempts) {
      const foreign = await call(s.app, method, path.replace('ID', goal.id), bob.cookies, body);
      const missing = await call(s.app, method, path.replace('ID', unknown), bob.cookies, body);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
    }
    expect(await getGoal(s, ana, goal.id)).toMatchObject({ name: 'Vacations', progress: '0' });
    expect(
      listGoalsResponseSchema.parse((await call(s.app, 'get', '/goals', bob.cookies)).body).goals,
    ).toEqual([]);
  });

  it('answers 409 to the 101st goal (AC-24)', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    await connection.pool.query(
      `insert into goals (owner_id, name, target_amount, currency)
       select $1, 'g' || n, 100, 'ARS' from generate_series(1, 100) as n`,
      [ana.id],
    );
    const response = await call(s.app, 'post', '/goals', ana.cookies, vacations());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'GOAL_LIMIT_REACHED' });
  });
});

describe('money and logs (NFR-01)', () => {
  it('serves money as strings and logs no goal name or amount', async () => {
    const s = goalsSetup(connection);
    const ana = await s.addUser('ana');
    const goal = await createGoal(s, ana, vacations({ name: 'Secret-Name-777' }));
    await call(s.app, 'post', `/goals/${goal.id}/entries`, ana.cookies, {
      kind: 'contribution',
      amount: '123457',
    });
    const response = await call(s.app, 'get', `/goals/${goal.id}`, ana.cookies);
    const body = response.body as Record<string, unknown>;
    for (const field of ['targetAmount', 'progress', 'monthlyAmountNeeded']) {
      expect(typeof body[field]).toBe('string');
    }
    expect(Number.isInteger(body['percentage'])).toBe(true);
    await call(s.app, 'patch', `/goals/${goal.id}`, ana.cookies, { targetAmount: '987651' });
    await call(s.app, 'delete', `/goals/${goal.id}`, ana.cookies);

    const logged = s.lines.join('\n');
    expect(logged).toContain(goal.id);
    expect(logged).not.toContain('Secret-Name-777');
    expect(logged).not.toContain('123457');
    expect(logged).not.toContain('987651');
  });
});
