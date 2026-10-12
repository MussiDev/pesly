import { randomUUID } from 'node:crypto';
import {
  AUTOMATIC_SEND_CATEGORY_KEY,
  activityPageSchema,
  sendMovementToGroupResponseSchema,
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

interface World {
  api: ReturnType<typeof setupGroupApi>;
  ana: TestUser;
  bob: TestUser;
  groupId: string;
  accountId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
  split: { mode: 'equal'; memberIds: string[] };
}

const codeOf = (body: unknown): string => (body as { code: string }).code;

async function world(): Promise<World> {
  const api = setupGroupApi(connection);
  const ana = await api.makeUser('ana');
  const bob = await api.makeUser('bob');
  const group = await createGroup(api.app, ana);
  const joined = await call(api.app, 'post', '/groups/join', bob.cookies, {
    token: await invitationTokenOf(api.app, ana, group.id),
  });
  expect(joined.status).toBe(200);
  const detail = await readGroup(api.app, ana, group.id);
  return {
    api,
    ana,
    bob,
    groupId: group.id,
    accountId: await newAccount(connection.pool, ana.id, false, 'ARS'),
    expenseCategoryId: await newCategory(connection.pool, ana.id, 'expense'),
    incomeCategoryId: await newCategory(connection.pool, ana.id, 'income'),
    split: { mode: 'equal', memberIds: detail.members.map((m) => m.id) },
  };
}

async function movement(
  w: World,
  type: 'expense' | 'income' = 'expense',
  note: string | null = 'Cena con amigos',
): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source, note)
     values ($1, $2, $3, $4, 5000000, '2026-10-09T10:00:00.000Z', 14000000, 'manual', $5) returning id`,
    [
      w.ana.id,
      type,
      w.accountId,
      type === 'expense' ? w.expenseCategoryId : w.incomeCategoryId,
      note,
    ],
  );
  return result.rows[0]?.id ?? '';
}

function send(w: World, body: Record<string, unknown>, user: TestUser = w.ana, groupId?: string) {
  return call(
    w.api.app,
    'post',
    `/groups/${groupId ?? w.groupId}/expenses/from-movement`,
    user.cookies,
    body,
  );
}

async function categoryRows(groupId: string) {
  const result = await connection.pool.query<{
    id: string;
    name: string | null;
    default_key: string | null;
    archived_at: Date | null;
  }>('select id, name, default_key, archived_at from group_categories where group_id = $1', [
    groupId,
  ]);
  return result.rows;
}

async function expenseCount(groupId: string): Promise<number> {
  const result = await connection.pool.query('select 1 from group_expenses where group_id = $1', [
    groupId,
  ]);
  return result.rowCount ?? 0;
}

async function clearCategories(groupId: string): Promise<void> {
  await connection.pool.query('delete from group_categories where group_id = $1', [groupId]);
}

describe('POST /groups/:id/expenses/from-movement', () => {
  it('sends an expense movement: 201, string amounts, the movement as payer movement, no auto category', async () => {
    const w = await world();
    const movementId = await movement(w);
    const response = await send(w, { movementId, split: w.split });
    expect(response.status).toBe(201);
    const body = sendMovementToGroupResponseSchema.parse(response.body);
    expect(body.payerMovementId).toBe(movementId);
    expect(body.amount).toBe('5000000');
    expect(body.autoCategory).toBeNull();
    expect(body.description).toBe('Cena con amigos');
    expect(body.shares.reduce((sum, s) => sum + BigInt(s.amount), 0n)).toBe(5000000n);
  });

  it('creates the automatic category, then restores it once archived', async () => {
    const w = await world();
    await clearCategories(w.groupId);
    const first = await send(w, { movementId: await movement(w), split: w.split });
    expect(first.status).toBe(201);
    expect(sendMovementToGroupResponseSchema.parse(first.body).autoCategory).toBe('created');
    const rows = await categoryRows(w.groupId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.default_key).toBe(AUTOMATIC_SEND_CATEGORY_KEY);
    expect(rows[0]?.name).toBeNull();

    await connection.pool.query(
      'update group_categories set archived_at = now() where group_id = $1',
      [w.groupId],
    );
    const second = await send(w, { movementId: await movement(w), split: w.split });
    expect(second.status).toBe(201);
    expect(sendMovementToGroupResponseSchema.parse(second.body).autoCategory).toBe('restored');
  });

  it('lets a non-admin member create the automatic category', async () => {
    const w = await world();
    await clearCategories(w.groupId);
    const account = await newAccount(connection.pool, w.bob.id, false, 'ARS');
    const category = await newCategory(connection.pool, w.bob.id, 'expense');
    const inserted = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, 1000, now(), 14000000, 'manual') returning id`,
      [w.bob.id, account, category],
    );
    const response = await send(
      w,
      { movementId: inserted.rows[0]?.id, description: 'Cafe', split: w.split },
      w.bob,
    );
    expect(response.status).toBe(201);
    expect(sendMovementToGroupResponseSchema.parse(response.body).autoCategory).toBe('created');
  });

  it.each(['categoryName', 'name', 'icon', 'color', 'categoryKey'])(
    'rejects a body naming %s and creates no category',
    async (key) => {
      const w = await world();
      await clearCategories(w.groupId);
      const response = await send(w, { movementId: await movement(w), split: w.split, [key]: 'x' });
      expect(response.status).toBe(400);
      expect(codeOf(response.body)).toBe('VALIDATION_FAILED');
      expect(await categoryRows(w.groupId)).toHaveLength(0);
    },
  );

  it.each(['amount', 'currency', 'occurredAt', 'accountId', 'payerMemberId'])(
    'rejects a body naming %s and writes nothing',
    async (key) => {
      const w = await world();
      const response = await send(w, { movementId: await movement(w), split: w.split, [key]: 'x' });
      expect(response.status).toBe(400);
      expect(codeOf(response.body)).toBe('VALIDATION_FAILED');
      expect(await expenseCount(w.groupId)).toBe(0);
    },
  );

  it('leaves the categories as they were when a send is refused', async () => {
    const w = await world();
    const other = await createGroup(w.api.app, w.ana, { name: 'Otro', defaultRateType: 'mep' });
    const income = await movement(w, 'income');
    const sent = await movement(w);
    expect((await send(w, { movementId: sent, split: w.split })).status).toBe(201);
    await clearCategories(other.id);
    const otherDetail = await readGroup(w.api.app, w.ana, other.id);
    const split = { mode: 'equal', memberIds: otherDetail.members.map((m) => m.id) };
    expect((await send(w, { movementId: income, split }, w.ana, other.id)).status).toBe(400);
    expect((await send(w, { movementId: sent, split }, w.ana, other.id)).status).toBe(409);
    expect(await categoryRows(other.id)).toHaveLength(0);
  });

  it('refuses income with GROUP_MOVEMENT_NOT_EXPENSE', async () => {
    const w = await world();
    const response = await send(w, { movementId: await movement(w, 'income'), split: w.split });
    expect(response.status).toBe(400);
    expect(codeOf(response.body)).toBe('GROUP_MOVEMENT_NOT_EXPENSE');
  });

  it('refuses a transfer and an exchange with GROUP_MOVEMENT_NOT_EXPENSE', async () => {
    const w = await world();
    const usd = await newAccount(connection.pool, w.ana.id, false, 'USD');
    const other = await newAccount(connection.pool, w.ana.id, false, 'ARS');
    const transfer = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, destination_account_id, amount, destination_amount, occurred_at)
       values ($1, 'transfer', $2, $3, 1000, 1000, now()) returning id`,
      [w.ana.id, w.accountId, other],
    );
    const exchange = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, destination_account_id, amount, destination_amount, occurred_at, rate, rate_source)
       values ($1, 'exchange', $2, $3, 140000, 100, now(), 14000000, 'implied') returning id`,
      [w.ana.id, w.accountId, usd],
    );
    for (const id of [transfer.rows[0]?.id, exchange.rows[0]?.id]) {
      const response = await send(w, { movementId: id, split: w.split });
      expect(response.status).toBe(400);
      expect(codeOf(response.body)).toBe('GROUP_MOVEMENT_NOT_EXPENSE');
    }
  });

  it('answers 409 GROUP_MOVEMENT_ALREADY_SENT the second time, leaking nothing', async () => {
    const w = await world();
    const movementId = await movement(w, 'expense', 'Secret note');
    expect((await send(w, { movementId, split: w.split })).status).toBe(201);
    const second = await send(w, { movementId, split: w.split });
    expect(second.status).toBe(409);
    expect(codeOf(second.body)).toBe('GROUP_MOVEMENT_ALREADY_SENT');
    const text = JSON.stringify(second.body);
    expect(text).not.toContain(movementId);
    expect(text).not.toContain('5000000');
    expect(text).not.toContain('Secret');
  });

  it('answers the same 404 for another user movement and an unknown one', async () => {
    const w = await world();
    const foreign = await send(w, { movementId: await movement(w), split: w.split }, w.bob);
    const unknown = await send(w, { movementId: randomUUID(), split: w.split });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);
  });

  it('answers the same 404 for a missing group and a group the caller is not in', async () => {
    const w = await world();
    const outsider = await w.api.makeUser('eve');
    const movementId = await movement(w);
    const foreign = await send(w, { movementId, split: w.split }, outsider);
    const missing = await send(w, { movementId, split: w.split }, w.ana, randomUUID());
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('refuses an archived or foreign category, a non-member split and bad descriptions', async () => {
    const w = await world();
    const movementId = await movement(w);
    const archived = (await categoryRows(w.groupId))[0];
    await connection.pool.query('update group_categories set archived_at = now() where id = $1', [
      archived?.id,
    ]);
    const a = await send(w, { movementId, categoryId: archived?.id, split: w.split });
    expect(a.status).toBe(400);
    expect(codeOf(a.body)).toBe('GROUP_EXPENSE_CATEGORY_INVALID');
    const b = await send(w, { movementId, categoryId: randomUUID(), split: w.split });
    expect(b.status).toBe(400);
    expect(codeOf(b.body)).toBe('GROUP_EXPENSE_CATEGORY_INVALID');
    const c = await send(w, { movementId, split: { mode: 'equal', memberIds: [randomUUID()] } });
    expect(c.status).toBe(400);
    expect(codeOf(c.body)).toBe('GROUP_SPLIT_MEMBER_INVALID');
    for (const description of ['x'.repeat(201), '']) {
      const d = await send(w, { movementId, description, split: w.split });
      expect(d.status).toBe(400);
      expect(codeOf(d.body)).toBe('VALIDATION_FAILED');
    }
    expect(await expenseCount(w.groupId)).toBe(0);
  });

  it('rejects a malformed id and a missing session, writing nothing', async () => {
    const w = await world();
    const bad = await send(w, { movementId: 'nope', split: w.split });
    expect(bad.status).toBe(400);
    const anonymous = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses/from-movement`,
      undefined,
      { movementId: await movement(w), split: w.split },
    );
    expect(anonymous.status).toBe(401);
    expect(await expenseCount(w.groupId)).toBe(0);
  });

  it('shows the creation entry with fromMovement and no account reference', async () => {
    const w = await world();
    expect((await send(w, { movementId: await movement(w), split: w.split })).status).toBe(201);
    const response = await call(w.api.app, 'get', `/groups/${w.groupId}/activity`, w.ana.cookies);
    expect(response.status).toBe(200);
    const page = activityPageSchema.parse(response.body);
    const entry = page.items.find((item) => item.action === 'expense_created');
    expect(entry?.fromMovement).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(w.accountId);
  });

  it('writes an audit line with ids only', async () => {
    const w = await world();
    const movementId = await movement(w, 'expense', 'Private note');
    expect((await send(w, { movementId, split: w.split })).status).toBe(201);
    const line = w.api.logLines().find((l) => l.includes('group expense created from movement'));
    expect(line).toBeDefined();
    expect(line).not.toContain('5000000');
    expect(line).not.toContain('Private note');
  });
});
