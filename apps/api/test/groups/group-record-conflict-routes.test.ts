import {
  activityPageSchema,
  groupExpenseResponseSchema,
  groupRecordConflictSchema,
  settlementResponseSchema,
  type ActivityPage,
} from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from '../movements/db-fixtures';
import {
  changeWorld,
  recordExpense,
  recordSettlement,
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

const expensePath = (w: ChangeWorld, id: string) => `/groups/${w.groupId}/expenses/${id}`;
const settlementPath = (w: ChangeWorld, id: string) => `/groups/${w.groupId}/settlements/${id}`;

async function activity(w: ChangeWorld): Promise<ActivityPage> {
  const response = await call(w.api.app, 'get', `/groups/${w.groupId}/activity`, w.ana.cookies);
  expect(response.status).toBe(200);
  return activityPageSchema.parse(response.body);
}

/** Bob edits from version 1, so the record is at version 2 and a second edit from 1 is stale. */
async function bobEditsFirst(
  w: ChangeWorld,
  id: string,
  overrides: Record<string, unknown> = {},
  editor: ChangeWorld['bob'] = w.bob,
) {
  const response = await call(
    w.api.app,
    'put',
    expensePath(w, id),
    editor.cookies,
    updateExpenseBody(w, { amount: '5000000', description: 'Cena de Bob', ...overrides }),
  );
  expect(response.status).toBe(200);
  return groupExpenseResponseSchema.parse(response.body);
}

describe('version on every expense and settlement response (AC-04)', () => {
  it('answers version 1 on POST and the stored version on GET and list', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const settlement = await recordSettlement(w);
    expect(expense.version).toBe(1);
    expect(settlement.version).toBe(1);

    const edited = await bobEditsFirst(w, expense.id);
    expect(edited.version).toBe(2);
    const fetched = await call(w.api.app, 'get', expensePath(w, expense.id), w.ana.cookies);
    expect(groupExpenseResponseSchema.parse(fetched.body).version).toBe(2);
    const listed = await call(w.api.app, 'get', `/groups/${w.groupId}/expenses`, w.ana.cookies);
    expect((listed.body as { items: { version: number }[] }).items.map((i) => i.version)).toEqual([
      2,
    ]);

    const patched = await call(
      w.api.app,
      'patch',
      settlementPath(w, settlement.id),
      w.bob.cookies,
      { baseVersion: 1, amount: '150000' },
    );
    expect(settlementResponseSchema.parse(patched.body).version).toBe(2);
    const settlements = await call(
      w.api.app,
      'get',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
    );
    expect(
      (settlements.body as { items: { version: number }[] }).items.map((i) => i.version),
    ).toEqual([2]);
  });
});

describe('PUT with a base version (AC-01)', () => {
  it('applies an edit with the current version and returns version + 1', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);

    const edited = await bobEditsFirst(w, expense.id);

    expect(edited).toMatchObject({ id: expense.id, version: 2, amount: '5000000' });
  });

  it('answers 409 GROUP_RECORD_CONFLICT to an older version and writes nothing, not even a log row', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    await bobEditsFirst(w, expense.id);
    const logBefore = (await activity(w)).items.length;
    const sharesQuery =
      'select member_id, amount::text from group_expense_shares where expense_id = $1 order by member_id';
    const sharesBefore = await connection.pool.query(sharesQuery, [expense.id]);

    const stale = await call(
      w.api.app,
      'put',
      expensePath(w, expense.id),
      w.ana.cookies,
      updateExpenseBody(w, { baseVersion: 1, amount: '9000000', description: 'Cena de Ana' }),
    );

    expect(stale.status).toBe(409);
    expect((stale.body as { code: string }).code).toBe('GROUP_RECORD_CONFLICT');
    const stored = await connection.pool.query<{ amount: string; description: string; v: number }>(
      'select amount::text, description, version as v from group_expenses where id = $1',
      [expense.id],
    );
    expect(stored.rows).toEqual([{ amount: '5000000', description: 'Cena de Bob', v: 2 }]);
    expect((await activity(w)).items).toHaveLength(logBefore);
    expect((await connection.pool.query(sharesQuery, [expense.id])).rows).toEqual(
      sharesBefore.rows,
    );
  });

  it('carries the server record in details.current, the same body a GET answers (AC-04)', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    await bobEditsFirst(w, expense.id);

    const stale = await call(
      w.api.app,
      'put',
      expensePath(w, expense.id),
      w.ana.cookies,
      updateExpenseBody(w, { baseVersion: 1, description: 'Cena de Ana' }),
    );
    const fetched = await call(w.api.app, 'get', expensePath(w, expense.id), w.ana.cookies);

    expect(stale.status).toBe(409);
    const details = (stale.body as { details: unknown }).details;
    expect(groupRecordConflictSchema.parse(details).current).toEqual(fetched.body);
    expect(fetched.body).toMatchObject({ description: 'Cena de Bob', version: 2 });
  });

  it('answers 409 to a future version: a client cannot invent one', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);

    const future = await call(
      w.api.app,
      'put',
      expensePath(w, expense.id),
      w.bob.cookies,
      updateExpenseBody(w, { baseVersion: 2 }),
    );

    expect(future.status).toBe(409);
    expect((future.body as { code: string }).code).toBe('GROUP_RECORD_CONFLICT');
    const stored = await connection.pool.query('select version from group_expenses where id = $1', [
      expense.id,
    ]);
    expect(stored.rows).toEqual([{ version: 1 }]);
  });

  it('keeps the payer movement and the shares unchanged after a conflict (AC-04)', async () => {
    const w = await changeWorld(connection);
    await connection.pool.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ('mep', 12900000, 13000000, now(), now())`,
    );
    const accountId = await newAccount(connection.pool, w.ana.id, false, 'ARS');
    const categoryId = await newCategory(connection.pool, w.ana.id, 'expense');
    const expense = await recordExpense(w, { payerAccount: { accountId, categoryId } }, w.ana);
    expect(expense.payerMovementId).not.toBeNull();
    const movement = () =>
      connection.pool.query('select amount::text, note from movements where id = $1', [
        expense.payerMovementId,
      ]);
    const before = await movement();
    await bobEditsFirst(w, expense.id, {}, w.ana);
    const afterFirst = await movement();
    expect(afterFirst.rows).not.toEqual(before.rows);

    const stale = await call(
      w.api.app,
      'put',
      expensePath(w, expense.id),
      w.ana.cookies,
      updateExpenseBody(w, { baseVersion: 1, amount: '9000000' }),
    );

    expect(stale.status).toBe(409);
    expect((await movement()).rows).toEqual(afterFirst.rows);
  });

  it('answers 400 to a request without baseVersion or with an invalid one', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const withoutBase: Record<string, unknown> = updateExpenseBody(w);
    delete withoutBase.baseVersion;

    for (const body of [
      withoutBase,
      updateExpenseBody(w, { baseVersion: 0 }),
      updateExpenseBody(w, { baseVersion: 1.5 }),
      updateExpenseBody(w, { baseVersion: '1' }),
    ]) {
      const response = await call(
        w.api.app,
        'put',
        expensePath(w, expense.id),
        w.bob.cookies,
        body,
      );
      expect(response.status).toBe(400);
      expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    }
  });

  it('applies two concurrent edits on the same version once: one 200, one 409, final version base + 1', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);

    const responses = await Promise.all([
      call(
        w.api.app,
        'put',
        expensePath(w, expense.id),
        w.bob.cookies,
        updateExpenseBody(w, { description: 'Uno' }),
      ),
      call(
        w.api.app,
        'put',
        expensePath(w, expense.id),
        w.ana.cookies,
        updateExpenseBody(w, { description: 'Dos' }),
      ),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = await connection.pool.query<{ version: number }>(
      'select version from group_expenses where id = $1',
      [expense.id],
    );
    expect(stored.rows[0]?.version).toBe(2);
    const updates = (await activity(w)).items.filter((i) => i.action === 'expense_updated');
    expect(updates).toHaveLength(1);
  });
});

describe('DELETE with a base version (AC-01)', () => {
  it('answers 409 to an older version and the expense remains', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    await bobEditsFirst(w, expense.id);

    const stale = await call(
      w.api.app,
      'delete',
      `${expensePath(w, expense.id)}?baseVersion=1`,
      w.ana.cookies,
    );

    expect(stale.status).toBe(409);
    expect(
      groupRecordConflictSchema.parse((stale.body as { details: unknown }).details).current,
    ).toMatchObject({ id: expense.id, version: 2 });
    const rows = await connection.pool.query('select 1 from group_expenses where id = $1', [
      expense.id,
    ]);
    expect(rows.rowCount).toBe(1);
    expect((await activity(w)).items.map((i) => i.action)).not.toContain('expense_deleted');
  });

  it('answers 400 without baseVersion or with an invalid one, and 409 to a future one', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    const settlement = await recordSettlement(w);

    for (const path of [expensePath(w, expense.id), settlementPath(w, settlement.id)]) {
      for (const query of ['', '?baseVersion=abc', '?baseVersion=0', '?baseVersion=1.5']) {
        const response = await call(w.api.app, 'delete', `${path}${query}`, w.bob.cookies);
        expect([path, query, response.status]).toEqual([path, query, 400]);
      }
      const future = await call(w.api.app, 'delete', `${path}?baseVersion=2`, w.bob.cookies);
      expect([path, future.status]).toEqual([path, 409]);
    }
  });
});

describe('PATCH and DELETE settlements with a base version (AC-01)', () => {
  it('answers 409 to an older version and keeps the stored settlement', async () => {
    const w = await changeWorld(connection);
    const settlement = await recordSettlement(w);
    const path = settlementPath(w, settlement.id);
    const first = await call(w.api.app, 'patch', path, w.bob.cookies, {
      baseVersion: 1,
      amount: '150000',
    });
    expect(first.status).toBe(200);
    const logBefore = (await activity(w)).items.length;

    const stale = await call(w.api.app, 'patch', path, w.ana.cookies, {
      baseVersion: 1,
      amount: '999',
    });
    const staleDelete = await call(w.api.app, 'delete', `${path}?baseVersion=1`, w.ana.cookies);

    expect(stale.status).toBe(409);
    expect((stale.body as { code: string }).code).toBe('GROUP_RECORD_CONFLICT');
    expect(
      groupRecordConflictSchema.parse((stale.body as { details: unknown }).details).current,
    ).toMatchObject({ id: settlement.id, amount: '150000', version: 2 });
    expect(staleDelete.status).toBe(409);
    const rows = await connection.pool.query<{ amount: string; version: number }>(
      'select amount::text, version from group_settlements where id = $1',
      [settlement.id],
    );
    expect(rows.rows).toEqual([{ amount: '150000', version: 2 }]);
    expect((await activity(w)).items).toHaveLength(logBefore);
  });

  it('answers 400 to a PATCH without baseVersion', async () => {
    const w = await changeWorld(connection);
    const settlement = await recordSettlement(w);

    const response = await call(
      w.api.app,
      'patch',
      settlementPath(w, settlement.id),
      w.bob.cookies,
      { amount: '150000' },
    );

    expect(response.status).toBe(400);
  });
});

describe('access comes before the conflict', () => {
  it('answers 404 to a non-member and 403 to a member who is not the author, even with a stale version', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    await bobEditsFirst(w, expense.id);
    const outsider = await w.api.makeUser('eve');
    const stale = updateExpenseBody(w, { baseVersion: 1 });
    const path = expensePath(w, expense.id);

    const asOutsider = await call(w.api.app, 'put', path, outsider.cookies, stale);
    const asCarol = await call(w.api.app, 'put', path, w.carol.cookies, stale);
    const carolDelete = await call(w.api.app, 'delete', `${path}?baseVersion=1`, w.carol.cookies);

    expect(asOutsider.status).toBe(404);
    expect(asCarol.status).toBe(403);
    expect(carolDelete.status).toBe(403);
    for (const response of [asOutsider, asCarol, carolDelete]) {
      expect(JSON.stringify(response.body)).not.toContain('current');
    }
  });
});

describe('conflict audit trail', () => {
  it('logs one info line with ids and both versions, and no amount or description', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w, { amount: '4123457', description: 'Secreto cena' });
    await bobEditsFirst(w, expense.id, { amount: '6123459', description: 'Secreto de Bob' });

    const stale = await call(
      w.api.app,
      'put',
      expensePath(w, expense.id),
      w.ana.cookies,
      updateExpenseBody(w, { baseVersion: 1, amount: '7123461', description: 'Secreto de Ana' }),
    );
    expect(stale.status).toBe(409);

    const lines = w.api.logLines();
    const conflict = lines.filter((line) => line.includes('group record conflict'));
    expect(conflict).toHaveLength(1);
    const entry = JSON.parse(conflict[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 30,
      userId: w.ana.id,
      groupId: w.groupId,
      expenseId: expense.id,
      baseVersion: 1,
      storedVersion: 2,
    });
    expect(entry.requestId).toBeDefined();
    const everything = lines.join('\n');
    for (const secret of [
      '4123457',
      '6123459',
      '7123461',
      'Secreto cena',
      'Secreto de Bob',
      'Secreto de Ana',
    ]) {
      expect(everything).not.toContain(secret);
    }
    // Only Bob's applied edit is audited as an update; the conflict is not.
    expect(lines.filter((line) => line.includes('group expense updated'))).toHaveLength(1);
  });

  it('keeps one activity row per applied change and none per conflict', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);
    w.api.clock.advance(1000);
    await bobEditsFirst(w, expense.id);
    w.api.clock.advance(1000);
    for (const baseVersion of [1, 3]) {
      const response = await call(
        w.api.app,
        'put',
        expensePath(w, expense.id),
        w.bob.cookies,
        updateExpenseBody(w, { baseVersion }),
      );
      expect(response.status).toBe(409);
    }
    w.api.clock.advance(1000);
    const del = await call(
      w.api.app,
      'delete',
      `${expensePath(w, expense.id)}?baseVersion=2`,
      w.bob.cookies,
    );
    expect(del.status).toBe(204);

    expect((await activity(w)).items.map((i) => i.action)).toEqual([
      'expense_deleted',
      'expense_updated',
      'expense_created',
    ]);
  });
});
