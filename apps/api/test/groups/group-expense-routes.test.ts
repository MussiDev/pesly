import { randomUUID } from 'node:crypto';
import {
  expenseOptionsResponseSchema,
  groupExpensePageSchema,
  groupExpenseResponseSchema,
  personalSharesPageSchema,
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
  type Method,
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
const MAX_AMOUNT = '1000000000000000';

interface World {
  api: ReturnType<typeof setupGroupApi>;
  ana: TestUser;
  bob: TestUser;
  groupId: string;
  anaMember: string;
  bobMember: string;
  ghostA: string;
  ghostB: string;
  categoryId: string;
  accountId: string;
  personalCategoryId: string;
}

function memberIdOf(
  detail: GroupDetailResponse,
  predicate: (m: GroupDetailResponse['members'][number]) => boolean,
): string {
  const member = detail.members.find(predicate);
  if (!member) throw new Error('member not found');
  return member.id;
}

/** Ana (admin, payer with an ARS account), Bob (member) and two ghosts. */
async function world(): Promise<World> {
  const api = setupGroupApi(connection);
  const ana = await api.makeUser('ana');
  const bob = await api.makeUser('bob');
  const group = await createGroup(api.app, ana);
  const joined = await call(api.app, 'post', '/groups/join', bob.cookies, {
    token: await invitationTokenOf(api.app, ana, group.id),
  });
  expect(joined.status).toBe(200);
  const ghosts: string[] = [];
  for (const displayName of ['Pedro', 'Lucia']) {
    const ghost = await call(api.app, 'post', `/groups/${group.id}/ghost-members`, ana.cookies, {
      displayName,
    });
    expect(ghost.status).toBe(201);
    ghosts.push((ghost.body as { id: string }).id);
  }
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
    ghostA: ghosts[0] ?? '',
    ghostB: ghosts[1] ?? '',
    categoryId: options.categories[0]?.id ?? '',
    accountId: await newAccount(connection.pool, ana.id, false, 'ARS'),
    personalCategoryId: await newCategory(connection.pool, ana.id, 'expense'),
  };
}

function equalBody(w: World, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount: '4000000',
    currency: 'ARS',
    occurredAt: OCCURRED_AT,
    payerMemberId: w.anaMember,
    categoryId: w.categoryId,
    description: 'Supermercado',
    split: { mode: 'equal', memberIds: [w.anaMember, w.bobMember, w.ghostA, w.ghostB] },
    payerAccount: { accountId: w.accountId, categoryId: w.personalCategoryId },
    ...overrides,
  };
}

function ghostPaidBody(w: World, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = equalBody(w);
  delete body.payerAccount;
  return { ...body, payerMemberId: w.ghostA, ...overrides };
}

async function record(
  w: World,
  user: TestUser,
  body: Record<string, unknown>,
): Promise<GroupExpenseResponse> {
  const response = await call(
    w.api.app,
    'post',
    `/groups/${w.groupId}/expenses`,
    user.cookies,
    body,
  );
  expect(response.status).toBe(201);
  return groupExpenseResponseSchema.parse(response.body);
}

async function count(table: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(`select count(*) as n from ${table}`);
  return Number(result.rows[0]?.n);
}

describe('POST /groups/:id/expenses', () => {
  it('records a valid expense and answers 201 with its shares, the payer movement included (AC-01, AC-14)', async () => {
    const w = await world();

    const expense = await record(w, w.ana, equalBody(w));

    expect(expense).toMatchObject({
      groupId: w.groupId,
      payerMemberId: w.anaMember,
      createdByMemberId: w.anaMember,
      amount: '4000000',
      currency: 'ARS',
      splitMode: 'equal',
    });
    expect(expense.shares).toHaveLength(4);
    expect(expense.shares.map((share) => share.amount)).toEqual([
      '1000000',
      '1000000',
      '1000000',
      '1000000',
    ]);
    expect(expense.payerMovementId).not.toBeNull();
    const movement = await connection.pool.query<{
      amount: string;
      account_id: string;
      type: string;
    }>('select amount, account_id, type from movements where id = $1', [expense.payerMovementId]);
    expect(movement.rows[0]).toEqual({
      amount: '4000000',
      account_id: w.accountId,
      type: 'expense',
    });

    const list = groupExpensePageSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}/expenses`, w.bob.cookies)).body,
    );
    expect(list.items.map((item) => item.id)).toEqual([expense.id]);
    const single = await call(
      w.api.app,
      'get',
      `/groups/${w.groupId}/expenses/${expense.id}`,
      w.bob.cookies,
    );
    expect(single.status).toBe(200);
    expect(groupExpenseResponseSchema.parse(single.body).id).toBe(expense.id);
  });

  it.each([
    ['an amount of 0', { amount: '0' }, 'VALIDATION_FAILED'],
    ['an unknown extra key', { extra: 1 }, 'VALIDATION_FAILED'],
    ['an empty equal split', { split: { mode: 'equal', memberIds: [] } }, 'VALIDATION_FAILED'],
    ['a malformed payer id', { payerMemberId: 'nope' }, 'VALIDATION_FAILED'],
    ['an empty description', { description: '   ' }, 'VALIDATION_FAILED'],
    [
      'a date more than a day ahead',
      { occurredAt: '2026-10-12T12:00:00.000Z' },
      'VALIDATION_FAILED',
    ],
  ])(
    'rejects %s with 400 and stores nothing (AC-02, AC-09, AC-11)',
    async (_label, overrides, code) => {
      const w = await world();
      const response = await call(
        w.api.app,
        'post',
        `/groups/${w.groupId}/expenses`,
        w.ana.cookies,
        equalBody(w, overrides),
      );
      expect(response.status).toBe(400);
      expect((response.body as { code: string }).code).toBe(code);
      expect(await count('group_expenses')).toBe(0);
      expect(await count('movements')).toBe(0);
    },
  );

  it('rejects a percentage split that does not total 100% with 400 (AC-09)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      equalBody(w, {
        split: {
          mode: 'percentage',
          shares: [
            { memberId: w.anaMember, basisPoints: 6000 },
            { memberId: w.bobMember, basisPoints: 3000 },
          ],
        },
      }),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('GROUP_SPLIT_PERCENTAGE_INVALID');
  });

  it('rejects an exact split that does not add up to the amount with 400 (AC-11)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      equalBody(w, {
        split: {
          mode: 'exact',
          shares: [
            { memberId: w.anaMember, amount: '1' },
            { memberId: w.bobMember, amount: '2' },
          ],
        },
      }),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('GROUP_SPLIT_AMOUNT_MISMATCH');
  });

  it('answers 400 GROUP_SPLIT_MEMBER_INVALID for a member outside the group (AC-03)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      equalBody(w, {
        split: { mode: 'equal', memberIds: [w.anaMember, randomUUID()] },
      }),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('GROUP_SPLIT_MEMBER_INVALID');
    expect(await count('group_expenses')).toBe(0);
  });

  it('answers 400 for a category of another group (AC-04)', async () => {
    const w = await world();
    const other = await createGroup(w.api.app, w.ana);
    const foreign = expenseOptionsResponseSchema.parse(
      (await call(w.api.app, 'get', `/groups/${other.id}/expense-options`, w.ana.cookies)).body,
    ).categories[0]?.id;
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      equalBody(w, {
        categoryId: foreign,
      }),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('GROUP_EXPENSE_CATEGORY_INVALID');
  });

  it('lowers the payer ARS account by the full amount, rejects a USD expense on it and records no movement for a ghost payer (AC-14, AC-15, AC-16)', async () => {
    const w = await world();
    await record(w, w.ana, equalBody(w));
    const balance = await connection.pool.query<{ total: string }>(
      `select coalesce(sum(amount), 0)::text as total from movements where account_id = $1 and type = 'expense'`,
      [w.accountId],
    );
    expect(balance.rows[0]?.total).toBe('4000000');

    const usd = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      equalBody(w, {
        currency: 'USD',
      }),
    );
    expect(usd.status).toBe(400);
    expect((usd.body as { code: string }).code).toBe('GROUP_PAYER_ACCOUNT_INVALID');

    const missing = await call(w.api.app, 'post', `/groups/${w.groupId}/expenses`, w.ana.cookies, {
      ...equalBody(w),
      payerAccount: undefined,
    });
    expect(missing.status).toBe(400);
    expect((missing.body as { code: string }).code).toBe('GROUP_PAYER_ACCOUNT_INVALID');

    const before = await count('movements');
    const ghostPaid = await record(w, w.ana, ghostPaidBody(w));
    expect(ghostPaid.payerMovementId).toBeNull();
    expect(await count('movements')).toBe(before);
  });

  it('accepts the maximum amount and rejects one unit more (NFR-01)', async () => {
    const w = await world();
    const ok = await record(w, w.ana, ghostPaidBody(w, { amount: MAX_AMOUNT }));
    expect(ok.amount).toBe(MAX_AMOUNT);
    const over = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      ghostPaidBody(w, {
        amount: '1000000000000001',
      }),
    );
    expect(over.status).toBe(400);
    expect((over.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('PUT /groups/:id/default-split and GET /groups/:id/expense-options', () => {
  it('lets an admin store 60/40, which the options return, and answers 403 to a member (AC-05, AC-06)', async () => {
    const w = await world();
    const split = {
      mode: 'percentage',
      shares: [
        { memberId: w.anaMember, basisPoints: 6000 },
        { memberId: w.bobMember, basisPoints: 4000 },
      ],
    };

    const denied = await call(
      w.api.app,
      'put',
      `/groups/${w.groupId}/default-split`,
      w.bob.cookies,
      split,
    );
    expect(denied.status).toBe(403);
    expect((denied.body as { code: string }).code).toBe('GROUP_ADMIN_REQUIRED');

    const stored = await call(
      w.api.app,
      'put',
      `/groups/${w.groupId}/default-split`,
      w.ana.cookies,
      split,
    );
    expect(stored.status).toBe(200);
    expect(stored.body).toEqual(split);

    const options = expenseOptionsResponseSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}/expense-options`, w.bob.cookies)).body,
    );
    expect(options.defaultSplit).toEqual(split);
    expect(options.members).toHaveLength(4);
    expect(options.defaultRateType).toBe('mep');
  });

  it('rejects a default split that does not total 100% or names a stranger with 400 (AC-05)', async () => {
    const w = await world();
    const path = `/groups/${w.groupId}/default-split`;
    const short = await call(w.api.app, 'put', path, w.ana.cookies, {
      mode: 'percentage',
      shares: [{ memberId: w.anaMember, basisPoints: 5000 }],
    });
    expect(short.status).toBe(400);
    const stranger = await call(w.api.app, 'put', path, w.ana.cookies, {
      mode: 'percentage',
      shares: [{ memberId: randomUUID(), basisPoints: 10000 }],
    });
    expect(stranger.status).toBe(400);
    expect((stranger.body as { code: string }).code).toBe('GROUP_SPLIT_MEMBER_INVALID');
  });

  it('omits an archived category and offers a new one (AC-19, AC-20)', async () => {
    const w = await world();
    const path = `/groups/${w.groupId}/categories`;
    const created = await call(w.api.app, 'post', path, w.ana.cookies, {
      name: 'Mascotas',
      icon: 'utensils',
      color: 'orange',
    });
    expect(created.status).toBe(201);
    const newId = (created.body as { id: string }).id;
    const archived = await call(w.api.app, 'patch', `${path}/${w.categoryId}`, w.ana.cookies, {
      archived: true,
    });
    expect(archived.status).toBe(200);

    const options = expenseOptionsResponseSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}/expense-options`, w.ana.cookies)).body,
    );
    const ids = options.categories.map((category) => category.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(w.categoryId);

    const rejected = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      equalBody(w),
    );
    expect(rejected.status).toBe(400);
    expect((rejected.body as { code: string }).code).toBe('GROUP_EXPENSE_CATEGORY_INVALID');
  });
});

describe('GET /groups/personal/shares', () => {
  it('shows the payer a 10,000.00 share and a 30,000.00 receivable and another member only the share (AC-17, AC-18)', async () => {
    const w = await world();
    const expense = await record(w, w.ana, equalBody(w));

    const anaView = personalSharesPageSchema.parse(
      (await call(w.api.app, 'get', '/groups/personal/shares', w.ana.cookies)).body,
    );
    expect(anaView.items).toHaveLength(1);
    expect(anaView.items[0]).toMatchObject({
      expenseId: expense.id,
      groupId: w.groupId,
      shareAmount: '1000000',
      receivableAmount: '3000000',
    });

    const bobBefore = await count('movements');
    const bobView = personalSharesPageSchema.parse(
      (await call(w.api.app, 'get', '/groups/personal/shares', w.bob.cookies)).body,
    );
    expect(bobView.items).toHaveLength(1);
    expect(bobView.items[0]).toMatchObject({ shareAmount: '1000000', receivableAmount: null });
    expect(await count('movements')).toBe(bobBefore);
  });

  it('rejects an unknown query key and a bad limit with 400', async () => {
    const w = await world();
    for (const query of ['?extra=1', '?limit=0', '?limit=101', '?from=yesterday']) {
      const response = await call(
        w.api.app,
        'get',
        `/groups/personal/shares${query}`,
        w.ana.cookies,
      );
      expect(response.status).toBe(400);
    }
  });

  it('shows a claimed ghost expenses and shares in the claimer personal view (AC-21)', async () => {
    const w = await world();
    const carol = await w.api.makeUser('carol');
    await record(w, w.ana, equalBody(w));
    await record(w, w.ana, ghostPaidBody(w));

    const link = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/members/${w.ghostA}/claim-links`,
      w.ana.cookies,
    );
    expect(link.status).toBe(201);
    const claimed = await call(w.api.app, 'post', '/groups/claim', carol.cookies, {
      token: (link.body as { token: string }).token,
    });
    expect(claimed.status).toBe(200);

    const view = personalSharesPageSchema.parse(
      (await call(w.api.app, 'get', '/groups/personal/shares', carol.cookies)).body,
    );
    expect(view.items).toHaveLength(2);
    expect(view.items.map((item) => item.shareAmount)).toEqual(['1000000', '1000000']);
    expect(view.items.filter((item) => item.receivableAmount !== null)).toHaveLength(1);
  });
});

describe('access (AC-23)', () => {
  it('answers 404 to a non-member on every route and to a missing expense id', async () => {
    const w = await world();
    const outsider = await w.api.makeUser('eve');
    const expense = await record(w, w.ana, equalBody(w));
    const routes: { method: Method; path: string; body?: Record<string, unknown> }[] = [
      { method: 'post', path: `/groups/${w.groupId}/expenses`, body: equalBody(w) },
      { method: 'get', path: `/groups/${w.groupId}/expenses` },
      { method: 'get', path: `/groups/${w.groupId}/expenses/${expense.id}` },
      { method: 'get', path: `/groups/${w.groupId}/expense-options` },
      { method: 'put', path: `/groups/${w.groupId}/default-split`, body: { mode: 'equal' } },
    ];
    for (const route of routes) {
      const response = await call(
        w.api.app,
        route.method,
        route.path,
        outsider.cookies,
        route.body,
      );
      expect(response.status, `${route.method} ${route.path}`).toBe(404);
    }
    expect(await count('group_expenses')).toBe(1);

    const missing = await call(
      w.api.app,
      'get',
      `/groups/${w.groupId}/expenses/${randomUUID()}`,
      w.ana.cookies,
    );
    expect(missing.status).toBe(404);

    const otherGroup = await createGroup(w.api.app, w.bob);
    const crossGroup = await call(
      w.api.app,
      'get',
      `/groups/${otherGroup.id}/expenses/${expense.id}`,
      w.bob.cookies,
    );
    expect(crossGroup.status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    const w = await world();
    expect((await call(w.api.app, 'get', '/groups/personal/shares')).status).toBe(401);
    expect((await call(w.api.app, 'get', `/groups/${w.groupId}/expenses`)).status).toBe(401);
  });
});

describe('GET /groups/:id/expenses pagination', () => {
  it('returns each expense once across pages, newest first (AC-01)', async () => {
    const w = await world();
    const ids: string[] = [];
    for (const day of ['08', '09', '10']) {
      ids.push(
        (await record(w, w.ana, ghostPaidBody(w, { occurredAt: `2026-10-${day}T09:00:00.000Z` })))
          .id,
      );
    }
    const first = groupExpensePageSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}/expenses?limit=2`, w.ana.cookies)).body,
    );
    expect(first.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(first.nextCursor).not.toBeNull();
    const second = groupExpensePageSchema.parse(
      (
        await call(
          w.api.app,
          'get',
          `/groups/${w.groupId}/expenses?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
          w.ana.cookies,
        )
      ).body,
    );
    expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
  });
});
