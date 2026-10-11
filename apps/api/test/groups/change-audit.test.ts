import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  changeWorld,
  recordExpense,
  recordSettlement,
  updateExpenseBody,
} from './change-routes-world';
import { call } from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('edit and delete audit trail (AC-08, AC-09)', () => {
  it('writes one audit line per change with ids only, no amount and no description', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w, { amount: '4123457', description: 'Secreto cena' });
    const settlement = await recordSettlement(w, { amount: '7654321' });
    const expensePath = `/groups/${w.groupId}/expenses/${expense.id}`;
    const settlementPath = `/groups/${w.groupId}/settlements/${settlement.id}`;

    const edit = await call(
      w.api.app,
      'put',
      expensePath,
      w.bob.cookies,
      updateExpenseBody(w, { amount: '6123459', description: 'Secreto editado' }),
    );
    expect(edit.status).toBe(200);
    const patch = await call(w.api.app, 'patch', settlementPath, w.bob.cookies, {
      amount: '7654323',
    });
    expect(patch.status).toBe(200);
    expect((await call(w.api.app, 'delete', settlementPath, w.bob.cookies)).status).toBe(204);
    expect((await call(w.api.app, 'delete', expensePath, w.bob.cookies)).status).toBe(204);

    const lines = w.api.logLines();
    const expected: [string, string][] = [
      ['group expense updated', expense.id],
      ['group expense deleted', expense.id],
      ['group settlement updated', settlement.id],
      ['group settlement deleted', settlement.id],
    ];
    for (const [message, recordId] of expected) {
      const matching = lines.filter((line) => line.includes(message));
      expect([message, matching.length]).toEqual([message, 1]);
      for (const id of [w.bob.id, w.groupId, recordId]) expect(matching[0]).toContain(id);
      expect(matching[0]).toContain('requestId');
    }
    const everything = lines.join('\n');
    for (const secret of [
      '4123457',
      '6123459',
      '7654321',
      '7654323',
      'Secreto cena',
      'Secreto editado',
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('writes no audit line when the change is refused with 403', async () => {
    const w = await changeWorld(connection);
    const expense = await recordExpense(w);

    const response = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/expenses/${expense.id}`,
      w.carol.cookies,
    );

    expect(response.status).toBe(403);
    expect(w.api.logLines().some((line) => line.includes('group expense deleted'))).toBe(false);
  });
});
