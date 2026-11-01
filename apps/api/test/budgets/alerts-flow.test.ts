import { randomUUID } from 'node:crypto';
import { listNoticesResponseSchema, type ListNoticesResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBudgetAlertListener, createBudgetRoutes } from '../../src/budgets';
import {
  BestEffortExpenseSavedHook,
  createExpenseRecorder,
  createMovementRoutes,
  createRecurringExpenseRecorder,
} from '../../src/movements';
import type { ExpenseSavedListener } from '../../src/movements/application/ports/expense-saved-listener';
import { createNoticesRoutes, renderBudgetAlertText } from '../../src/notices';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { newAccount, newCategory, writeScope } from '../movements/db-fixtures';
import { MovableClock, PASSWORD, type Owner } from './route-harness';
import { newCard, newStatement } from '../reports/flow-fixtures';
import { newBudgetWithVersions, newMovementAt } from './spending-fixtures';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const OCTOBER = new Date('2026-10-06T16:00:00.000Z');
const HOUR = 3_600_000;
const RATE = { source: 'manual', value: '14000000' } as const;
const RECORDER_RATE = { source: 'manual' as const, value: 14_000_000n };

let connection: DatabaseConnection;
let sequence = 0;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

interface Clocked {
  now(): Date;
}

interface Options {
  /** Replaces the text renderer of the store, to force it to fail. */
  renderText?: typeof renderBudgetAlertText;
}

/** The real use cases and adapters of movements, budgets and notices behind one app. */
function buildWorld(clock: Clocked = new MovableClock(OCTOBER), options: Options = {}) {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const evaluations = { count: 0 };
  const inner = createBudgetAlertListener(connection.db, {
    renderText: options.renderText ?? renderBudgetAlertText,
    clock,
  });
  const listener: ExpenseSavedListener = {
    afterExpenseSaved: (scope, event) => {
      evaluations.count += 1;
      return inner.afterExpenseSaved(scope, event);
    },
  };
  const expenseSaved = new BestEffortExpenseSavedHook(listener, (failure) => {
    logger.error(failure, 'budget alert evaluation failed');
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createBudgetRoutes({ db: connection.db, logger, clock }),
      createMovementRoutes({ db: connection.db, logger, clock, expenseSaved }),
      createNoticesRoutes({ db: connection.db, logger }),
    ],
  });
  return { app: harness.app, lines, clock, expenseSaved, evaluations, logger };
}

type World = ReturnType<typeof buildWorld>;

async function person(app: Express, name: string, language: 'es' | 'en' = 'es'): Promise<Owner> {
  sequence += 1;
  const email = `${name}-${sequence}@alerts-flow.test`;
  const id = await seedUser(connection, {
    email,
    password: PASSWORD,
    timeZone: BUENOS_AIRES,
    language,
  });
  return { id, cookies: sessionFrom(await signIn(app, email, PASSWORD)) };
}

async function named(ownerId: string, name: string, kind = 'expense'): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, name, icon, color)
     values ($1, $2, $3, 'wallet', 'blue') returning id`,
    [ownerId, kind, name],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('The category insert returned no row');
  return id;
}

function send(
  app: Express,
  method: 'post' | 'put' | 'patch' | 'delete' | 'get',
  path: string,
  owner: Owner | undefined,
  body?: object,
) {
  const req = request(app)[method](path).set(trustedHeaders);
  if (owner) req.set('Cookie', cookieHeader(owner.cookies));
  return body === undefined ? req : req.send(body);
}

/** An expense an hour ago, or `ago` milliseconds ago. */
function expenseBody(
  world: World,
  accountId: string,
  categoryId: string,
  amount: bigint,
  ago = HOUR,
) {
  return {
    type: 'expense',
    accountId,
    categoryId,
    amount: amount.toString(),
    occurredAt: new Date(world.clock.now().getTime() - ago).toISOString(),
    rate: RATE,
  };
}

async function spend(
  world: World,
  owner: Owner,
  accountId: string,
  categoryId: string,
  amount: bigint,
  extra: object = {},
) {
  const response = await send(world.app, 'post', '/movements', owner, {
    ...expenseBody(world, accountId, categoryId, amount),
    ...extra,
  });
  expect(response.status).toBeLessThan(300);
  return response.body as { id: string };
}

async function notices(app: Express, owner: Owner): Promise<ListNoticesResponse> {
  const response = await send(app, 'get', '/notices?limit=50', owner);
  expect(response.status).toBe(200);
  return listNoticesResponseSchema.parse(response.body);
}

async function texts(app: Express, owner: Owner): Promise<string[]> {
  return (await notices(app, owner)).items.map((notice) => notice.text).sort();
}

async function markCount(ownerId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from budget_alert_marks where owner_id = $1',
    [ownerId],
  );
  return Number(result.rows[0]?.n);
}

async function outings(owner: Owner, name = 'Outings') {
  return {
    account: await newAccount(connection.pool, owner.id),
    category: await named(owner.id, name),
  };
}

async function createBudget(world: World, owner: Owner, fields: object): Promise<string> {
  const response = await send(world.app, 'post', '/budgets', owner, fields);
  expect(response.status).toBe(201);
  return (response.body as { id: string }).id;
}

const codeOf = (body: unknown) =>
  (body as { error?: { code?: string }; code?: string }).error?.code ??
  (body as { code?: string }).code;

const ES_80 = 'Outings alcanzó el 80% de su presupuesto';
const ES_100 = 'Outings alcanzó el 100% de su presupuesto';

describe('budget alerts flow over PostgreSQL', () => {
  it('publishes one readable notice at 80% and none for a second expense above it (AC-01, AC-05, AC-17)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const { account, category } = await outings(ana);
    await createBudget(world, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [category],
    });

    await spend(world, ana, account, category, 12000000n);
    const first = await notices(world.app, ana);
    await spend(world, ana, account, category, 1000000n);
    const second = await notices(world.app, ana);

    expect(first.items.map((notice) => [notice.kind, notice.text])).toEqual([
      ['budget_alert', ES_80],
    ]);
    expect(first.unreadCount).toBe(1);
    expect(first.items[0]?.text).not.toMatch(/\d{4}|\$|ARS/);
    expect(second.items).toHaveLength(1);
  });

  it('publishes the 80% notice in October for a September card purchase whose statement is due in October (AC-11)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const { account, category } = await outings(ana);
    const pool = connection.pool;
    const cardArs = await newAccount(pool, ana.id);
    const cardUsd = await newAccount(pool, ana.id, false, 'USD');
    const cardId = await newCard(pool, {
      ownerId: ana.id,
      arsAccountId: cardArs,
      usdAccountId: cardUsd,
      closingDay: 24,
      dueDay: 5,
    });
    await newStatement(pool, {
      cardId,
      ownerId: ana.id,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-10-05',
    });
    await newMovementAt(pool, {
      ownerId: ana.id,
      accountId: cardArs,
      categoryId: category,
      amount: 12000000n,
      occurredAt: '2026-09-20T15:00:00Z',
    });
    await createBudget(world, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [category],
    });

    await spend(world, ana, account, category, 100n);

    expect(await texts(world.app, ana)).toEqual([ES_80]);
  });

  it('publishes two notices for 70% to 110% and evaluates a rollover budget against its available amount (AC-02, AC-04)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const plain = await outings(ana);
    await spend(world, ana, plain.account, plain.category, 10500000n);
    await createBudget(world, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [plain.category],
    });
    expect(await texts(world.app, ana)).toEqual([]);

    await spend(world, ana, plain.account, plain.category, 6000000n);
    const afterJump = await texts(world.app, ana);

    // September left 10,000,000 unspent, so 25,000,000 is available and 80% is 20,000,000.
    const rolling = await named(ana.id, 'Rolling');
    await newBudgetWithVersions(connection.pool, {
      ownerId: ana.id,
      versions: [
        {
          effectiveFrom: '2026-09-01',
          name: 'Rolling',
          amount: 15000000n,
          rollover: true,
          categoryIds: [rolling],
        },
        {
          effectiveFrom: '2026-10-01',
          name: 'Rolling',
          amount: 15000000n,
          rollover: true,
          categoryIds: [rolling],
        },
      ],
    });
    await newMovementAt(connection.pool, {
      ownerId: ana.id,
      accountId: plain.account,
      categoryId: rolling,
      amount: 5000000n,
      occurredAt: '2026-09-10T12:00:00Z',
    });
    await spend(world, ana, plain.account, rolling, 16000000n);
    const belowAvailable = await texts(world.app, ana);
    await spend(world, ana, plain.account, rolling, 4000000n);
    const atAvailable = await texts(world.app, ana);

    expect(afterJump).toEqual([ES_100, ES_80]);
    expect(belowAvailable).toEqual(afterJump);
    expect(atAvailable).toEqual([ES_100, ES_80, 'Rolling alcanzó el 80% de su presupuesto'].sort());
  });

  it('publishes when an edit crosses a threshold and nothing when an expense is deleted and added back (AC-06, AC-12)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const { account, category } = await outings(ana);
    await createBudget(world, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [category],
    });
    const expense = await spend(world, ana, account, category, 10000000n);
    expect(await texts(world.app, ana)).toEqual([]);

    const edited = await send(world.app, 'put', `/movements/${expense.id}`, ana, {
      ...expenseBody(world, account, category, 13000000n),
      rate: { source: 'keep' },
    });
    const afterEdit = await texts(world.app, ana);
    const deleted = await send(world.app, 'delete', `/movements/${expense.id}`, ana);
    await spend(world, ana, account, category, 13000000n);

    expect(edited.status).toBe(200);
    expect(afterEdit).toEqual([ES_80]);
    expect(deleted.status).toBe(204);
    expect(await texts(world.app, ana)).toEqual([ES_80]);
  });

  it('alerts through the device path, a recurring recording and a card installment, but not for an income, a transfer or an exchange (AC-07, AC-08)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const account = await newAccount(connection.pool, ana.id);
    const usd = await newAccount(connection.pool, ana.id, false, 'USD');
    const second = await newAccount(connection.pool, ana.id);
    const scope = await writeScope(ana.id);
    const names = ['Device', 'Recurring', 'Card', 'Quiet'];
    const categories: Record<string, string> = {};
    for (const name of names) {
      categories[name] = await named(ana.id, name);
      await createBudget(world, ana, {
        name,
        amount: '15000000',
        currency: 'ARS',
        categoryIds: [categories[name]],
        thresholds: [80],
      });
    }
    const device = categories.Device as string;
    const recurring = categories.Recurring as string;
    const card = categories.Card as string;
    const occurredAt = new Date(world.clock.now().getTime() - HOUR);
    const recorded = (categoryId: string) => ({
      accountId: account,
      categoryId,
      amount: 12000000n,
      occurredAt,
      rate: RECORDER_RATE,
    });

    const deviceId = randomUUID();
    await spend(world, ana, account, device, 12000000n, { id: deviceId });
    const replay = await send(world.app, 'post', '/movements', ana, {
      ...expenseBody(world, account, device, 12000000n),
      id: deviceId,
    });
    await createRecurringExpenseRecorder(connection.db, world.logger, {
      clock: world.clock,
      expenseSaved: world.expenseSaved,
    }).recordOnce(scope, randomUUID(), recorded(recurring));
    await createExpenseRecorder(connection.db, world.logger, {
      clock: world.clock,
      expenseSaved: world.expenseSaved,
    }).record(scope, recorded(card));
    const published = await texts(world.app, ana);
    const evaluationsBefore = world.evaluations.count;

    // A budget over an expense category is not touched by an income, a transfer or an exchange.
    const incomeCategory = await newCategory(connection.pool, ana.id, 'income');
    const occurred = new Date(world.clock.now().getTime() - HOUR).toISOString();
    const quietResponses = [
      await send(world.app, 'post', '/movements', ana, {
        type: 'income',
        accountId: account,
        categoryId: incomeCategory,
        amount: '99000000',
        occurredAt: occurred,
        rate: RATE,
      }),
      await send(world.app, 'post', '/movements', ana, {
        type: 'transfer',
        accountId: account,
        destinationAccountId: second,
        amount: '99000000',
        occurredAt: occurred,
      }),
      await send(world.app, 'post', '/movements', ana, {
        type: 'exchange',
        accountId: account,
        destinationAccountId: usd,
        amount: '99000000',
        destinationAmount: '70000',
        occurredAt: occurred,
      }),
    ];

    expect(replay.status).toBe(200);
    expect(published).toEqual(
      ['Device', 'Recurring', 'Card'].map((n) => `${n} alcanzó el 80% de su presupuesto`).sort(),
    );
    expect(quietResponses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(world.evaluations.count).toBe(evaluationsBefore);
    expect(await texts(world.app, ana)).toEqual(published);
  });

  it('publishes nothing for a back-dated September expense, and again in a new month (AC-10, AC-14)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const { account, category } = await outings(ana);
    await createBudget(world, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [category],
    });

    await spend(world, ana, account, category, 20000000n, {
      occurredAt: '2026-09-15T12:00:00.000Z',
    });
    const backDated = await texts(world.app, ana);
    await spend(world, ana, account, category, 12000000n);
    const october = await notices(world.app, ana);
    (world.clock as MovableClock).current = new Date('2026-11-04T16:00:00.000Z');
    await spend(world, ana, account, category, 12000000n);
    const november = await notices(world.app, ana);

    expect(backDated).toEqual([]);
    expect(october.items.map((notice) => notice.text)).toEqual([ES_80]);
    expect(november.items.map((notice) => notice.text)).toEqual([ES_80, ES_80]);
  });

  it('leaves exactly one notice for two simultaneous requests that cross the same threshold (AC-13)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const { account, category } = await outings(ana);
    await createBudget(world, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [category],
      thresholds: [80],
    });

    const responses = await Promise.all([
      send(world.app, 'post', '/movements', ana, expenseBody(world, account, category, 12000000n)),
      send(world.app, 'post', '/movements', ana, expenseBody(world, account, category, 12000000n)),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await texts(world.app, ana)).toEqual([ES_80]);
    expect(await markCount(ana.id)).toBe(1);
  });

  it('notifies the owner only, never a user with a budget over an identically named category (AC-19)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const bruno = await person(world.app, 'bruno');
    const mine = await outings(ana);
    const theirs = await outings(bruno);
    for (const [owner, category] of [
      [ana, mine.category],
      [bruno, theirs.category],
    ] as const) {
      await createBudget(world, owner, {
        name: 'Outings',
        amount: '15000000',
        currency: 'ARS',
        categoryIds: [category],
      });
    }

    await spend(world, ana, mine.account, mine.category, 12000000n);

    expect(await texts(world.app, ana)).toEqual([ES_80]);
    expect(await texts(world.app, bruno)).toEqual([]);
    expect(await markCount(bruno.id)).toBe(0);
  });

  it('still answers 201 when the store fails and logs the error name and code, no budget name or amount (AC-18)', async () => {
    const failing = buildWorld(new MovableClock(OCTOBER), {
      renderText: () => {
        throw Object.assign(new Error('Outings 12000000 leaked'), { code: 'XX001' });
      },
    });
    const healthy = buildWorld();
    const run = async (world: World) => {
      const ana = await person(world.app, 'ana');
      const { account, category } = await outings(ana);
      await createBudget(world, ana, {
        name: 'Outings',
        amount: '15000000',
        currency: 'ARS',
        categoryIds: [category],
      });
      const response = await send(
        world.app,
        'post',
        '/movements',
        ana,
        expenseBody(world, account, category, 12000000n),
      );
      return { ana, response };
    };

    const broken = await run(failing);
    const fine = await run(healthy);

    expect(broken.response.status).toBe(201);
    expect(Object.keys(broken.response.body as object).sort()).toEqual(
      Object.keys(fine.response.body as object).sort(),
    );
    const failures = failing.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'budget alert evaluation failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      errorName: 'Error',
      errorCode: 'XX001',
      userId: broken.ana.id,
    });
    expect(failing.lines.join('\n')).not.toMatch(/Outings|12000000/);
    expect(await texts(failing.app, broken.ana)).toEqual([]);
    expect(await markCount(broken.ana.id)).toBe(0);
  });

  it('answers 401 with no session and 404 for another user movement, evaluating nothing (AC-19)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const bruno = await person(world.app, 'bruno');
    const { account, category } = await outings(ana);
    const expense = await spend(world, ana, account, category, 1000n);
    const before = world.evaluations.count;

    const anonymous = await send(
      world.app,
      'post',
      '/movements',
      undefined,
      expenseBody(world, account, category, 1000n),
    );
    const foreign = await send(world.app, 'put', `/movements/${expense.id}`, bruno, {
      ...expenseBody(world, account, category, 2000n),
      rate: { source: 'keep' },
    });

    expect(anonymous.status).toBe(401);
    expect(codeOf(anonymous.body)).toBe('UNAUTHENTICATED');
    expect(foreign.status).toBe(404);
    expect(codeOf(foreign.body)).toBe('NOT_FOUND');
    expect(world.evaluations.count).toBe(before);
  });

  it('alerts a lowered amount at the next expense without repeating a mark, and deleting the budget removes its marks (AC-21, AC-22)', async () => {
    const world = buildWorld();
    const ana = await person(world.app, 'ana');
    const { account, category } = await outings(ana);
    const budgetId = await createBudget(world, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [category],
    });
    await spend(world, ana, account, category, 13000000n);
    expect(await texts(world.app, ana)).toEqual([ES_80]);

    const lowered = await send(world.app, 'patch', `/budgets/${budgetId}`, ana, {
      amount: '10000000',
    });
    const atEdit = await texts(world.app, ana);
    await spend(world, ana, account, category, 100000n);
    const afterNext = await texts(world.app, ana);
    const marksBefore = await markCount(ana.id);
    const deleted = await send(world.app, 'delete', `/budgets/${budgetId}`, ana);

    expect(lowered.status).toBe(200);
    expect(atEdit).toEqual([ES_80]);
    expect(afterNext).toEqual([ES_100, ES_80]);
    expect(marksBefore).toBe(2);
    expect(deleted.status).toBe(204);
    expect(await markCount(ana.id)).toBe(0);
    expect(await texts(world.app, ana)).toEqual([ES_100, ES_80]);
  });

  it('makes the notice readable within 5 seconds of the response, in the language of the user (AC-15, AC-23)', async () => {
    const world = buildWorld({ now: () => new Date() });
    const ana = await person(world.app, 'ana');
    const eva = await person(world.app, 'eva', 'en');
    for (const owner of [ana, eva]) {
      const { account, category } = await outings(owner);
      await createBudget(world, owner, {
        name: 'Outings',
        amount: '15000000',
        currency: 'ARS',
        categoryIds: [category],
      });
      const response = await send(
        world.app,
        'post',
        '/movements',
        owner,
        // Dated now, not an hour ago: this test runs on the real clock, and between 00:00 and 01:00
        // on the 1st an hour ago is last month, which raises no alert by design.
        expenseBody(world, account, category, 12000000n, 0),
      );
      expect(response.status).toBe(201);
    }
    const answered = Date.now();

    const spanish = await texts(world.app, ana);
    const english = await texts(world.app, eva);

    expect(Date.now() - answered).toBeLessThan(5000);
    expect(spanish).toEqual([ES_80]);
    expect(english).toEqual(['Outings reached 80% of its budget']);
  });

  it('publishes the same notices from a second API instance sharing nothing but the database (stateless rule)', async () => {
    const first = buildWorld();
    const second = buildWorld(first.clock);
    const ana = await person(first.app, 'ana');
    const { account, category } = await outings(ana);
    await createBudget(first, ana, {
      name: 'Outings',
      amount: '15000000',
      currency: 'ARS',
      categoryIds: [category],
    });

    await spend(first, ana, account, category, 12000000n);
    await spend(second, ana, account, category, 4000000n);
    await spend(second, ana, account, category, 1000n);

    expect(await texts(first.app, ana)).toEqual([ES_100, ES_80]);
    expect(await texts(second.app, ana)).toEqual([ES_100, ES_80]);
  });
});
