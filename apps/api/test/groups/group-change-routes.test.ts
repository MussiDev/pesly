import {
  activityPageSchema,
  settlementResponseSchema,
  groupExpenseResponseSchema,
  type ActivityPage,
} from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  arsBalanceOf,
  changeWorld,
  recordExpense,
  recordSettlement,
  unknownId,
  updateExpenseBody,
  type ChangeWorld,
} from './change-routes-world';
import { call } from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function activity(w: ChangeWorld, query = '', user = w.ana): Promise<ActivityPage> {
  const response = await call(
    w.api.app,
    'get',
    `/groups/${w.groupId}/activity${query}`,
    user.cookies,
  );
  expect(response.status).toBe(200);
  return activityPageSchema.parse(response.body);
}

async function storedExpense(id: string) {
  const rows = await connection.pool.query<{ amount: string; description: string }>(
    'select amount::text, description from group_expenses where id = $1',
    [id],
  );
  return rows.rows[0];
}

async function leave(w: ChangeWorld, user: ChangeWorld['carol']): Promise<void> {
  const response = await call(w.api.app, 'post', `/groups/${w.groupId}/leave`, user.cookies);
  expect(response.status).toBe(204);
}

describe('PUT and DELETE /groups/:id/expenses/:expenseId', () => {
  it('lets the author edit and delete the expense (AC-01)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const path = `/groups/${w.groupId}/expenses/${expense.id}`;

    const edited = await call(w.api.app, 'put', path, w.bob.cookies, updateExpenseBody(w));
    expect(edited.status).toBe(200);
    expect(groupExpenseResponseSchema.parse(edited.body)).toMatchObject({
      id: expense.id,
      amount: '6000000',
      description: 'Cena editada',
      currency: 'ARS',
      payerMemberId: w.anaMember,
    });
    const fetched = await call(w.api.app, 'get', path, w.bob.cookies);
    expect(groupExpenseResponseSchema.parse(fetched.body).amount).toBe('6000000');

    const deleted = await call(w.api.app, 'delete', path, w.bob.cookies);
    expect(deleted.status).toBe(204);
    expect((await call(w.api.app, 'get', path, w.bob.cookies)).status).toBe(404);
  });

  it('lets an admin who did not record it edit and delete the expense', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const path = `/groups/${w.groupId}/expenses/${expense.id}`;

    const edited = await call(w.api.app, 'put', path, w.ana.cookies, updateExpenseBody(w));
    expect(edited.status).toBe(200);
    expect((await call(w.api.app, 'delete', path, w.ana.cookies)).status).toBe(204);
  });

  it('answers 403 to a member who is neither the author nor an admin and changes nothing (AC-03)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const path = `/groups/${w.groupId}/expenses/${expense.id}`;

    const put = await call(w.api.app, 'put', path, w.carol.cookies, updateExpenseBody(w));
    const del = await call(w.api.app, 'delete', path, w.carol.cookies);

    expect(put.status).toBe(403);
    expect((put.body as { code: string }).code).toBe('GROUP_RECORD_EDIT_FORBIDDEN');
    expect(del.status).toBe(403);
    expect(await storedExpense(expense.id)).toEqual({ amount: '4000000', description: 'Cena' });
    expect((await activity(w)).items.map((item) => item.action)).toEqual(['expense_created']);
  });

  it('moves the balances when 40,000.00 becomes 60,000.00 ARS (AC-05)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    expect(await arsBalanceOf(w, w.bobMember)).toBe('-2000000');

    const edited = await call(
      w.api.app,
      'put',
      `/groups/${w.groupId}/expenses/${expense.id}`,
      w.bob.cookies,
      updateExpenseBody(w),
    );

    expect(edited.status).toBe(200);
    expect(await arsBalanceOf(w, w.bobMember)).toBe('-3000000');
    expect(await arsBalanceOf(w, w.anaMember)).toBe('3000000');
  });

  it('answers 400 for a split that does not add up and leaves the expense unchanged (AC-07)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);

    const response = await call(
      w.api.app,
      'put',
      `/groups/${w.groupId}/expenses/${expense.id}`,
      w.bob.cookies,
      updateExpenseBody(w, {
        split: {
          mode: 'exact',
          shares: [
            { memberId: w.anaMember, amount: '1' },
            { memberId: w.bobMember, amount: '1' },
          ],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await storedExpense(expense.id)).toEqual({ amount: '4000000', description: 'Cena' });
    expect((await activity(w)).items).toHaveLength(1);
  });

  it('answers 400 for an unknown key such as currency (AC-07)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);

    const response = await call(
      w.api.app,
      'put',
      `/groups/${w.groupId}/expenses/${expense.id}`,
      w.bob.cookies,
      updateExpenseBody(w, { currency: 'USD' }),
    );

    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    expect(await storedExpense(expense.id)).toEqual({ amount: '4000000', description: 'Cena' });
  });

  it('answers 409 when the expense touches a member who left and changes nothing', async () => {
    const w = await changeWorld(connection);
    // Carol paid and shares the expense with Ana, then Ana pays her back: her balance is 0 and she
    // may leave, yet the expense still changes what she is owed.
    const expense = await recordExpense(w, {
      payerMemberId: w.carolMember,
      split: { mode: 'equal', memberIds: [w.carolMember, w.anaMember] },
    });
    await recordSettlement(w, {
      fromMemberId: w.anaMember,
      toMemberId: w.carolMember,
      amount: '2000000',
    });
    await leave(w, w.carol);
    const path = `/groups/${w.groupId}/expenses/${expense.id}`;

    const put = await call(w.api.app, 'put', path, w.ana.cookies, updateExpenseBody(w));
    const del = await call(w.api.app, 'delete', path, w.ana.cookies);

    expect(put.status).toBe(409);
    expect((put.body as { code: string }).code).toBe('GROUP_RECORD_FORMER_MEMBER');
    expect(del.status).toBe(409);
    expect(await storedExpense(expense.id)).toEqual({ amount: '4000000', description: 'Cena' });
  });
});

describe('PATCH and DELETE /groups/:id/settlements/:settlementId', () => {
  it('lets an admin who did not record it edit and delete the settlement (AC-02)', async () => {
    const w = await changeWorld(connection);
    const settlement = await recordSettlement(w);
    const path = `/groups/${w.groupId}/settlements/${settlement.id}`;

    const edited = await call(w.api.app, 'patch', path, w.ana.cookies, { amount: '250000' });
    expect(edited.status).toBe(200);
    expect(settlementResponseSchema.parse(edited.body)).toMatchObject({
      id: settlement.id,
      amount: '250000',
      legs: [{ currency: 'ARS', amount: '250000' }],
    });

    expect((await call(w.api.app, 'delete', path, w.ana.cookies)).status).toBe(204);
    const rows = await connection.pool.query('select 1 from group_settlements where id = $1', [
      settlement.id,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('answers 403 to a member who is neither the author nor an admin and changes nothing (AC-04)', async () => {
    const w = await changeWorld(connection);
    const settlement = await recordSettlement(w);
    const path = `/groups/${w.groupId}/settlements/${settlement.id}`;

    const patch = await call(w.api.app, 'patch', path, w.carol.cookies, { amount: '250000' });
    const del = await call(w.api.app, 'delete', path, w.carol.cookies);

    expect(patch.status).toBe(403);
    expect((patch.body as { code: string }).code).toBe('GROUP_RECORD_EDIT_FORBIDDEN');
    expect(del.status).toBe(403);
    const rows = await connection.pool.query<{ amount: string }>(
      'select amount::text from group_settlements where id = $1',
      [settlement.id],
    );
    expect(rows.rows).toEqual([{ amount: '100000' }]);
  });

  it('restores the balances when the settlement is deleted (AC-06)', async () => {
    const w = await changeWorld(connection);
    await recordExpense(w);
    const before = await arsBalanceOf(w, w.bobMember);
    const settlement = await recordSettlement(w);
    expect(await arsBalanceOf(w, w.bobMember)).not.toBe(before);

    const deleted = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/settlements/${settlement.id}`,
      w.bob.cookies,
    );

    expect(deleted.status).toBe(204);
    expect(await arsBalanceOf(w, w.bobMember)).toBe(before);
  });

  it('answers 400 for an empty body or an unknown key', async () => {
    const w = await changeWorld(connection);
    const settlement = await recordSettlement(w);
    const path = `/groups/${w.groupId}/settlements/${settlement.id}`;

    expect((await call(w.api.app, 'patch', path, w.bob.cookies, {})).status).toBe(400);
    const unknownKey = await call(w.api.app, 'patch', path, w.bob.cookies, {
      amount: '5',
      currency: 'USD',
    });
    expect(unknownKey.status).toBe(400);
  });

  it('answers 409 when a party left and changes nothing', async () => {
    const w = await changeWorld(connection);
    // Carol and Ana settle each way so Carol's balance is 0 and she may leave.
    const settlement = await recordSettlement(w, {
      fromMemberId: w.carolMember,
      toMemberId: w.anaMember,
    });
    await recordSettlement(w, { fromMemberId: w.anaMember, toMemberId: w.carolMember });
    await leave(w, w.carol);
    const path = `/groups/${w.groupId}/settlements/${settlement.id}`;

    const patch = await call(w.api.app, 'patch', path, w.ana.cookies, { amount: '1' });
    const del = await call(w.api.app, 'delete', path, w.ana.cookies);

    expect(patch.status).toBe(409);
    expect((patch.body as { code: string }).code).toBe('GROUP_RECORD_FORMER_MEMBER');
    expect(del.status).toBe(409);
  });

  it('answers 409 when editing a consolidated settlement, and deleting it works', async () => {
    const w = await changeWorld(connection);
    await connection.pool.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ('mep', 9900000, 10000000, now(), now())`,
    );
    // Bob owes Ana 100.00 USD and Ana owes Bob 50,000.00 ARS.
    await recordExpense(w, { currency: 'USD', amount: '20000' });
    await recordExpense(w, { amount: '10000000', payerMemberId: w.bobMember }, w.ana);
    const preview = await call(
      w.api.app,
      'get',
      `/groups/${w.groupId}/settlements/consolidation?memberA=${w.anaMember}&memberB=${w.bobMember}&currency=USD`,
      w.ana.cookies,
    );
    expect(preview.status).toBe(200);
    const created = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      {
        kind: 'consolidated',
        memberIds: [w.anaMember, w.bobMember],
        currency: 'USD',
        occurredAt: '2026-10-10T10:00:00.000Z',
        legs: (preview.body as { legs: unknown }).legs,
      },
    );
    expect(created.status).toBe(201);
    const path = `/groups/${w.groupId}/settlements/${settlementResponseSchema.parse(created.body).id}`;

    const patch = await call(w.api.app, 'patch', path, w.ana.cookies, { amount: '1' });

    expect(patch.status).toBe(409);
    expect((patch.body as { code: string }).code).toBe('GROUP_SETTLEMENT_CONSOLIDATED');
    expect((await call(w.api.app, 'delete', path, w.ana.cookies)).status).toBe(204);
  });

  it('keeps the consolidation preview route ahead of the settlement id routes', async () => {
    const w = await changeWorld(connection);
    const response = await call(
      w.api.app,
      'get',
      `/groups/${w.groupId}/settlements/consolidation?memberA=${w.anaMember}&memberB=${w.bobMember}&currency=USD`,
      w.ana.cookies,
    );
    expect(response.status).toBe(200);
  });
});

describe('GET /groups/:id/activity', () => {
  it('adds a visible log row with the before and after values to an edit and a deletion (AC-08, AC-09)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const path = `/groups/${w.groupId}/expenses/${expense.id}`;
    w.api.clock.advance(3_600_000);
    await call(w.api.app, 'put', path, w.bob.cookies, updateExpenseBody(w));
    w.api.clock.advance(3_600_000);
    await call(w.api.app, 'delete', path, w.ana.cookies);

    const page = await activity(w, '', w.carol);

    expect(page.items.map((item) => item.action)).toEqual([
      'expense_deleted',
      'expense_updated',
      'expense_created',
    ]);
    const [deleted, updated] = page.items;
    expect(deleted).toMatchObject({
      subjectType: 'expense',
      subjectId: expense.id,
      memberId: w.anaMember,
      createdAt: '2026-10-10T14:00:00.000Z',
      after: null,
      before: { amount: '6000000', description: 'Cena editada' },
    });
    expect(updated).toMatchObject({
      memberId: w.bobMember,
      before: { amount: '4000000', description: 'Cena' },
      after: { amount: '6000000', description: 'Cena editada' },
    });
  });

  it('lists every entry newest first with pagination to any member (AC-10)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    w.api.clock.advance(60_000);
    const settlement = await recordSettlement(w);
    w.api.clock.advance(60_000);
    await call(
      w.api.app,
      'put',
      `/groups/${w.groupId}/expenses/${expense.id}`,
      w.bob.cookies,
      updateExpenseBody(w),
    );
    w.api.clock.advance(60_000);
    await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/settlements/${settlement.id}`,
      w.bob.cookies,
    );

    const first = await activity(w, '?limit=3', w.carol);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await activity(
      w,
      `?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      w.carol,
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(4);
    expect(all.map((item) => item.action)).toEqual([
      'settlement_deleted',
      'expense_updated',
      'settlement_created',
      'expense_created',
    ]);
  });

  it('answers 400 for a limit outside 1 to 100 or an unknown query key', async () => {
    const w = await changeWorld(connection);
    for (const query of ['?limit=101', '?limit=0', '?foo=1']) {
      const response = await call(
        w.api.app,
        'get',
        `/groups/${w.groupId}/activity${query}`,
        w.ana.cookies,
      );
      expect([query, response.status]).toEqual([query, 400]);
    }
  });
});

describe('PUT, PATCH and DELETE /groups/:id/activity/:entryId', () => {
  it('answers 405 GROUP_ACTIVITY_LOG_IMMUTABLE to a member and leaves the entry unchanged (AC-11)', async () => {
    const w = await changeWorld(connection);
    await recordExpense(w);
    const entry = (await activity(w)).items[0];
    const path = `/groups/${w.groupId}/activity/${entry?.id}`;

    for (const method of ['put', 'patch', 'delete'] as const) {
      const response = await call(w.api.app, method, path, w.carol.cookies, { action: 'x' });
      expect([method, response.status]).toEqual([method, 405]);
      expect((response.body as { code: string }).code).toBe('GROUP_ACTIVITY_LOG_IMMUTABLE');
      expect(response.headers).toHaveProperty('allow');
    }
    expect((await activity(w)).items).toEqual([entry]);
  });
});

describe('access (AC-12)', () => {
  function everyRoute(w: ChangeWorld, expenseId: string, settlementId: string, entryId: string) {
    const base = `/groups/${w.groupId}`;
    return [
      { method: 'put', path: `${base}/expenses/${expenseId}`, body: updateExpenseBody(w) },
      { method: 'delete', path: `${base}/expenses/${expenseId}` },
      { method: 'patch', path: `${base}/settlements/${settlementId}`, body: { amount: '5' } },
      { method: 'delete', path: `${base}/settlements/${settlementId}` },
      { method: 'get', path: `${base}/activity` },
      { method: 'put', path: `${base}/activity/${entryId}`, body: {} },
      { method: 'patch', path: `${base}/activity/${entryId}`, body: {} },
      { method: 'delete', path: `${base}/activity/${entryId}` },
    ] as const;
  }

  it('answers 404 on every route to a non-member', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const settlement = await recordSettlement(w);
    const entry = (await activity(w)).items[0];
    const outsider = await w.api.makeUser('eve');

    for (const route of everyRoute(w, expense.id, settlement.id, entry?.id ?? '')) {
      const response = await call(
        w.api.app,
        route.method,
        route.path,
        outsider.cookies,
        'body' in route ? route.body : undefined,
      );
      expect([route.method, route.path, response.status]).toEqual([route.method, route.path, 404]);
    }
    expect((await activity(w)).items).toHaveLength(2);
  });

  it('answers 404 on every route to a user who left', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const settlement = await recordSettlement(w);
    const entry = (await activity(w)).items[0];
    await leave(w, w.carol);

    for (const route of everyRoute(w, expense.id, settlement.id, entry?.id ?? '')) {
      const response = await call(
        w.api.app,
        route.method,
        route.path,
        w.carol.cookies,
        'body' in route ? route.body : undefined,
      );
      expect([route.method, route.path, response.status]).toEqual([route.method, route.path, 404]);
    }
  });

  it('answers 404 for a missing expense or settlement', async () => {
    const w = await changeWorld(connection);
    const base = `/groups/${w.groupId}`;
    const real = await recordExpense(w);
    const ok = await call(
      w.api.app,
      'put',
      `${base}/expenses/${real.id}`,
      w.ana.cookies,
      updateExpenseBody(w),
    );
    expect(ok.status).toBe(200);

    const responses = [
      await call(
        w.api.app,
        'put',
        `${base}/expenses/${unknownId()}`,
        w.ana.cookies,
        updateExpenseBody(w),
      ),
      await call(w.api.app, 'delete', `${base}/expenses/${unknownId()}`, w.ana.cookies),
      await call(w.api.app, 'patch', `${base}/settlements/${unknownId()}`, w.ana.cookies, {
        amount: '5',
      }),
      await call(w.api.app, 'delete', `${base}/settlements/${unknownId()}`, w.ana.cookies),
    ];

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
  });

  it('answers 400 for ids that are not uuids', async () => {
    const w = await changeWorld(connection);
    const response = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/settlements/not-a-uuid`,
      w.ana.cookies,
    );
    expect(response.status).toBe(400);
  });
});
