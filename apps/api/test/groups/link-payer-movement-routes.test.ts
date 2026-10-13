import { randomUUID } from 'node:crypto';
import {
  expenseOptionsResponseSchema,
  groupExpenseResponseSchema,
  movementCandidatesResponseSchema,
  type GroupDetailResponse,
  type GroupExpenseResponse,
} from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from '../movements/db-fixtures';
import {
  call,
  createGroup,
  invitationTokenOf,
  readGroup,
  setupGroupApi,
  type TestUser,
} from './routes-harness';

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
     values ('mep', 12900000, 13000000, now(), now())`,
  );
});

const OCCURRED_AT = '2026-10-10T10:00:00.000Z';
const AMOUNT = '4000000';

interface World {
  api: ReturnType<typeof setupGroupApi>;
  ana: TestUser;
  bob: TestUser;
  groupId: string;
  anaMember: string;
  bobMember: string;
  ghost: string;
  categoryId: string;
  anaAccount: string;
  anaCategory: string;
}

function memberIdOf(
  detail: GroupDetailResponse,
  predicate: (m: GroupDetailResponse['members'][number]) => boolean,
): string {
  const member = detail.members.find(predicate);
  if (!member) throw new Error('member not found');
  return member.id;
}

/** Ana (admin, registered, with an ARS account), Bob (member) and a ghost. */
async function world(): Promise<World> {
  const api = setupGroupApi(connection);
  const ana = await api.makeUser('ana');
  const bob = await api.makeUser('bob');
  const group = await createGroup(api.app, ana);
  const joined = await call(api.app, 'post', '/groups/join', bob.cookies, {
    token: await invitationTokenOf(api.app, ana, group.id),
  });
  expect(joined.status).toBe(200);
  const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
    displayName: 'Pedro',
  });
  expect(ghost.status).toBe(201);
  const detail = await readGroup(api.app, ana, group.id);
  const options = expenseOptionsResponseSchema.parse(
    (await call(api.app, 'get', `/groups/${group.id}/expense-options`, ana.cookies)).body,
  );
  return {
    api,
    ana,
    bob,
    groupId: group.id,
    anaMember: memberIdOf(detail, (m) => m.role === 'admin'),
    bobMember: memberIdOf(detail, (m) => m.role === 'member' && !m.isGhost),
    ghost: (ghost.body as { id: string }).id,
    categoryId: options.categories[0]?.id ?? '',
    anaAccount: await newAccount(connection.pool, ana.id, false, 'ARS'),
    anaCategory: await newCategory(connection.pool, ana.id, 'expense'),
  };
}

/** Bob records an expense that Ana paid: no payer account, so no movement is written for her. */
async function paidByAna(w: World, overrides: Record<string, unknown> = {}) {
  const response = await call(w.api.app, 'post', `/groups/${w.groupId}/expenses`, w.bob.cookies, {
    amount: AMOUNT,
    currency: 'ARS',
    occurredAt: OCCURRED_AT,
    payerMemberId: w.anaMember,
    categoryId: w.categoryId,
    description: 'Supermercado',
    split: { mode: 'equal', memberIds: [w.anaMember, w.bobMember] },
    ...overrides,
  });
  expect(response.status).toBe(201);
  const expense = groupExpenseResponseSchema.parse(response.body);
  expect(expense.payerMovementId).toBeNull();
  return expense;
}

const link = (w: World, user: TestUser, expenseId: string, body: Record<string, unknown>) =>
  call(
    w.api.app,
    'post',
    `/groups/${w.groupId}/expenses/${expenseId}/payer-movement`,
    user.cookies,
    body,
  );

const candidates = (w: World, user: TestUser, expenseId: string) =>
  call(
    w.api.app,
    'get',
    `/groups/${w.groupId}/expenses/${expenseId}/movement-candidates`,
    user.cookies,
  );

const createBody = (w: World, overrides: Record<string, unknown> = {}) => ({
  mode: 'create',
  accountId: w.anaAccount,
  categoryId: w.anaCategory,
  ...overrides,
});

/** One of Ana's own expense movements, as she would have registered it herself. */
async function ownMovement(
  w: World,
  fields: { amount?: string; accountId?: string; type?: 'expense' | 'income'; note?: string } = {},
): Promise<string> {
  const type = fields.type ?? 'expense';
  const category =
    type === 'expense' ? w.anaCategory : await newCategory(connection.pool, w.ana.id, 'income');
  const result = await connection.pool.query<{ id: string }>(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, note, rate, rate_source)
     values ($1, $2, $3, $4, $5, $6, $7, 14000000, 'manual') returning id`,
    [
      w.ana.id,
      type,
      fields.accountId ?? w.anaAccount,
      category,
      fields.amount ?? AMOUNT,
      OCCURRED_AT,
      fields.note ?? 'Chango',
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('no movement');
  return id;
}

async function scalar(sql: string, values: unknown[]): Promise<string> {
  const result = await connection.pool.query<{ n: string }>(sql, values);
  return String(result.rows[0]?.n);
}

const movementCount = (userId: string) =>
  scalar('select count(*) as n from movements where owner_id = $1', [userId]);
const logCount = (groupId: string) =>
  scalar('select count(*) as n from group_activity_log where group_id = $1', [groupId]);
const flags = async (expenseId: string) => {
  const result = await connection.pool.query<{
    payer_movement_id: string | null;
    adopted_movement: boolean;
    version: number;
  }>('select payer_movement_id, adopted_movement, version from group_expenses where id = $1', [
    expenseId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('no expense');
  return row;
};

describe('POST /groups/:id/expenses/:expenseId/payer-movement, create mode', () => {
  it('records the movement of the payer from the account and the category and links it (AC-02, AC-07)', async () => {
    const w = await world();
    const expense = await paidByAna(w);

    const response = await link(w, w.ana, expense.id, createBody(w));

    expect(response.status).toBe(200);
    const linked = groupExpenseResponseSchema.parse(response.body);
    expect(linked.payerMovementId).not.toBeNull();
    const movement = await connection.pool.query<{ occurred_at: Date }>(
      `select type, account_id, category_id, amount::text as amount, note, occurred_at
         from movements where id = $1`,
      [linked.payerMovementId],
    );
    expect(movement.rows[0]).toMatchObject({
      type: 'expense',
      account_id: w.anaAccount,
      category_id: w.anaCategory,
      amount: AMOUNT,
      note: 'Supermercado',
    });
    expect((movement.rows[0]?.occurred_at ?? new Date(0)).toISOString()).toBe(OCCURRED_AT);
    expect(await flags(expense.id)).toMatchObject({
      payer_movement_id: linked.payerMovementId,
      adopted_movement: false,
    });
  });

  it('changes neither the shares, the version nor the activity log, and answers the same expense (AC-17)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const logBefore = await logCount(w.groupId);

    const response = await link(w, w.ana, expense.id, createBody(w));

    const linked = groupExpenseResponseSchema.parse(response.body);
    expect(linked.version).toBe(expense.version);
    expect(linked.shares).toEqual(expense.shares);
    expect(await logCount(w.groupId)).toBe(logBefore);
    expect((await flags(expense.id)).version).toBe(expense.version);
  });

  it.each([
    ['a body that is neither shape', { mode: 'link' }],
    ['an extra key', { mode: 'adopt', movementId: randomUUID(), amount: '1' }],
    ['a mixed body', { mode: 'create', movementId: randomUUID() }],
  ])('answers 400 for %s and writes nothing (AC-01)', async (_name, body) => {
    const w = await world();
    const expense = await paidByAna(w);

    const response = await link(w, w.ana, expense.id, body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await movementCount(w.ana.id)).toBe('0');
    expect((await flags(expense.id)).payer_movement_id).toBeNull();
  });

  it('rejects an archived account, a foreign account and an account in another currency with 400 and no movement (AC-08, AC-31)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const archived = await newAccount(connection.pool, w.ana.id, true, 'ARS');
    const usd = await newAccount(connection.pool, w.ana.id, false, 'USD');
    const foreign = await newAccount(connection.pool, w.bob.id, false, 'ARS');
    const missing = randomUUID();

    const codes: unknown[] = [];
    for (const accountId of [archived, usd, foreign, missing]) {
      const response = await link(w, w.ana, expense.id, createBody(w, { accountId }));
      expect(response.status).toBe(400);
      codes.push(response.body);
    }

    expect(new Set(codes.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(codes[0]).toMatchObject({ code: 'GROUP_PAYER_ACCOUNT_INVALID' });
    expect(await movementCount(w.ana.id)).toBe('0');
  });

  it('rejects an income category, a foreign category and a missing one with the same 400 (AC-09, AC-31)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const income = await newCategory(connection.pool, w.ana.id, 'income');
    const foreign = await newCategory(connection.pool, w.bob.id, 'expense');

    for (const categoryId of [income, foreign, randomUUID()]) {
      const response = await link(w, w.ana, expense.id, createBody(w, { categoryId }));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'GROUP_PAYER_ACCOUNT_INVALID' });
    }
    expect(await movementCount(w.ana.id)).toBe('0');
  });

  it('deletes the movement together with the expense when it was linked in create mode (AC-10)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const linked = groupExpenseResponseSchema.parse(
      (await link(w, w.ana, expense.id, createBody(w))).body,
    );
    expect(await movementCount(w.ana.id)).toBe('1');

    const deleted = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/expenses/${expense.id}?baseVersion=${String(linked.version)}`,
      w.ana.cookies,
    );

    expect(deleted.status).toBe(204);
    expect(await movementCount(w.ana.id)).toBe('0');
  });
});

describe('POST /groups/:id/expenses/:expenseId/payer-movement, adopt mode', () => {
  it('links a movement of the same amount and currency without creating or changing one (AC-11, AC-16)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const movementId = await ownMovement(w);

    const response = await link(w, w.ana, expense.id, { mode: 'adopt', movementId });

    expect(response.status).toBe(200);
    expect(groupExpenseResponseSchema.parse(response.body).payerMovementId).toBe(movementId);
    expect(await movementCount(w.ana.id)).toBe('1');
    expect(await flags(expense.id)).toMatchObject({
      payer_movement_id: movementId,
      adopted_movement: true,
    });
  });

  it('keeps and detaches the adopted movement when the expense is deleted (AC-16)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const movementId = await ownMovement(w);
    const linked = groupExpenseResponseSchema.parse(
      (await link(w, w.ana, expense.id, { mode: 'adopt', movementId })).body,
    );

    const deleted = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/expenses/${expense.id}?baseVersion=${String(linked.version)}`,
      w.ana.cookies,
    );

    expect(deleted.status).toBe(204);
    expect(await movementCount(w.ana.id)).toBe('1');
  });

  it('carries the new amount and date to the adopted movement on an edit and keeps its note (AC-16)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const movementId = await ownMovement(w, { note: 'Chango' });
    const linked = groupExpenseResponseSchema.parse(
      (await link(w, w.ana, expense.id, { mode: 'adopt', movementId })).body,
    );

    const edited = await call(
      w.api.app,
      'put',
      `/groups/${w.groupId}/expenses/${expense.id}`,
      w.ana.cookies,
      {
        amount: '4500000',
        occurredAt: '2026-10-09T10:00:00.000Z',
        categoryId: w.categoryId,
        description: 'Otro nombre',
        split: { mode: 'equal', memberIds: [w.anaMember, w.bobMember] },
        baseVersion: linked.version,
      },
    );

    expect(edited.status).toBe(200);
    const row = await connection.pool.query<{ amount: string; note: string; occurred_at: Date }>(
      'select amount::text as amount, note, occurred_at from movements where id = $1',
      [movementId],
    );
    expect(row.rows[0]).toMatchObject({ amount: '4500000', note: 'Chango' });
    expect((row.rows[0]?.occurred_at ?? new Date(0)).toISOString()).toBe(
      '2026-10-09T10:00:00.000Z',
    );
  });

  it('rejects a movement that is an income with 400 GROUP_MOVEMENT_NOT_EXPENSE (AC-12)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const movementId = await ownMovement(w, { type: 'income' });

    const response = await link(w, w.ana, expense.id, { mode: 'adopt', movementId });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'GROUP_MOVEMENT_NOT_EXPENSE' });
    expect((await flags(expense.id)).payer_movement_id).toBeNull();
  });

  it('answers 409 GROUP_MOVEMENT_ALREADY_SENT for a movement that another expense already holds (AC-13)', async () => {
    const w = await world();
    const first = await paidByAna(w);
    const second = await paidByAna(w, { description: 'Otro' });
    const movementId = await ownMovement(w);
    expect((await link(w, w.ana, first.id, { mode: 'adopt', movementId })).status).toBe(200);

    const response = await link(w, w.ana, second.id, { mode: 'adopt', movementId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'GROUP_MOVEMENT_ALREADY_SENT' });
  });

  it('rejects a movement of another amount or in another currency with 400 GROUP_MOVEMENT_MISMATCH (AC-14)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const otherAmount = await ownMovement(w, { amount: '4000001' });
    const usd = await newAccount(connection.pool, w.ana.id, false, 'USD');
    const otherCurrency = await ownMovement(w, { accountId: usd });

    for (const movementId of [otherAmount, otherCurrency]) {
      const response = await link(w, w.ana, expense.id, { mode: 'adopt', movementId });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'GROUP_MOVEMENT_MISMATCH' });
    }
    expect((await flags(expense.id)).payer_movement_id).toBeNull();
  });

  it('answers the same 404 for a missing movement and for another user movement (AC-15, AC-31)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const bobAccount = await newAccount(connection.pool, w.bob.id, false, 'ARS');
    const bobCategory = await newCategory(connection.pool, w.bob.id, 'expense');
    const foreign = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, $4, $5, 14000000, 'manual') returning id`,
      [w.bob.id, bobAccount, bobCategory, AMOUNT, OCCURRED_AT],
    );

    const missing = await link(w, w.ana, expense.id, { mode: 'adopt', movementId: randomUUID() });
    const other = await link(w, w.ana, expense.id, {
      mode: 'adopt',
      movementId: foreign.rows[0]?.id ?? '',
    });

    expect(missing.status).toBe(404);
    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });
});

describe('who can link, and when', () => {
  it('forbids a member who is not the payer with 403 GROUP_PAYER_ONLY and writes nothing (AC-03)', async () => {
    const w = await world();
    const expense = await paidByAna(w);

    const response = await link(w, w.bob, expense.id, createBody(w));

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'GROUP_PAYER_ONLY' });
    expect(await movementCount(w.ana.id)).toBe('0');
  });

  it('forbids linking an expense paid by a ghost member with 403 GROUP_PAYER_ONLY (AC-04)', async () => {
    const w = await world();
    const expense = await paidByAna(w, { payerMemberId: w.ghost });

    const response = await link(w, w.ana, expense.id, createBody(w));

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'GROUP_PAYER_ONLY' });
  });

  it('answers 409 GROUP_EXPENSE_ALREADY_LINKED for an expense that has a movement, and leaves it (AC-05)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const first = groupExpenseResponseSchema.parse(
      (await link(w, w.ana, expense.id, createBody(w))).body,
    );

    const again = await link(w, w.ana, expense.id, createBody(w));

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'GROUP_EXPENSE_ALREADY_LINKED' });
    expect((await flags(expense.id)).payer_movement_id).toBe(first.payerMovementId);
    expect(await movementCount(w.ana.id)).toBe('1');
  });

  it('answers the same 404 for a missing group, a missing expense and a caller outside the group (AC-06)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const eve = await w.api.makeUser('eve');

    const responses = [
      await call(
        w.api.app,
        'post',
        `/groups/${randomUUID()}/expenses/${expense.id}/payer-movement`,
        w.ana.cookies,
        createBody(w),
      ),
      await link(w, w.ana, randomUUID(), createBody(w)),
      await link(w, eve, expense.id, createBody(w)),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(responses[0]?.body);
    }
  });

  it('answers 401 without a session', async () => {
    const w = await world();
    const expense = await paidByAna(w);

    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses/${expense.id}/payer-movement`,
      undefined,
      createBody(w),
    );

    expect(response.status).toBe(401);
  });
});

describe('two requests for the same expense (NFR-01)', () => {
  it('apply exactly one link and answer 409 to the rest, leaving one movement (AC-28)', async () => {
    const w = await world();
    const expense = await paidByAna(w);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => link(w, w.ana, expense.id, createBody(w))),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    expect(await movementCount(w.ana.id)).toBe('1');
  });
});

describe('GET /groups/:id/expenses/:expenseId/movement-candidates', () => {
  it('lists only the payer unlinked expense movements of the same amount and currency, newest first, at most 20 (AC-18)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const wanted = await ownMovement(w, { note: 'Chango' });
    await ownMovement(w, { amount: '4000001' });
    await ownMovement(w, { type: 'income' });
    const usd = await newAccount(connection.pool, w.ana.id, false, 'USD');
    await ownMovement(w, { accountId: usd });
    const taken = await ownMovement(w, { note: 'Ya enviado' });
    const other = await paidByAna(w, { description: 'Otro' });
    expect((await link(w, w.ana, other.id, { mode: 'adopt', movementId: taken })).status).toBe(200);
    // Another user's movement of the same amount never shows.
    const bobAccount = await newAccount(connection.pool, w.bob.id, false, 'ARS');
    const bobCategory = await newCategory(connection.pool, w.bob.id, 'expense');
    await connection.pool.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, $4, $5, 14000000, 'manual')`,
      [w.bob.id, bobAccount, bobCategory, AMOUNT, OCCURRED_AT],
    );

    const response = await candidates(w, w.ana, expense.id);

    expect(response.status).toBe(200);
    const list = movementCandidatesResponseSchema.parse(response.body);
    expect(list.items.map((item) => item.id)).toEqual([wanted]);
    expect(list.items[0]).toMatchObject({
      amount: AMOUNT,
      note: 'Chango',
      accountId: w.anaAccount,
    });
  });

  it('caps the list at 20 candidates (AC-18)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    for (let n = 0; n < 23; n += 1) await ownMovement(w, { note: `Compra ${String(n)}` });

    const response = await candidates(w, w.ana, expense.id);

    expect(movementCandidatesResponseSchema.parse(response.body).items).toHaveLength(20);
  });

  it('forbids a member who is not the payer and answers 409 for an expense already linked (AC-19)', async () => {
    const w = await world();
    const expense = await paidByAna(w);

    const forbidden = await candidates(w, w.bob, expense.id);
    expect((await link(w, w.ana, expense.id, createBody(w))).status).toBe(200);
    const linked = await candidates(w, w.ana, expense.id);

    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'GROUP_PAYER_ONLY' });
    expect(linked.status).toBe(409);
    expect(linked.body).toMatchObject({ code: 'GROUP_EXPENSE_ALREADY_LINKED' });
  });

  it('answers 404 for a caller outside the group (AC-06)', async () => {
    const w = await world();
    const expense = await paidByAna(w);
    const eve = await w.api.makeUser('eve');

    expect((await candidates(w, eve, expense.id)).status).toBe(404);
  });
});

export type { GroupExpenseResponse };
