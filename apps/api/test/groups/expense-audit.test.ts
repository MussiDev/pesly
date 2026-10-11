import { groupExpenseResponseSchema, expenseOptionsResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from '../movements/db-fixtures';
import { call, createGroup, setupGroupApi } from './routes-harness';

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

describe('expense audit trail (AC-22)', () => {
  it('adds a log row and an audit line with ids only, never the amount or the description', async () => {
    const api = setupGroupApi(connection);
    const ana = await api.makeUser('ana');
    const group = await createGroup(api.app, ana);
    const options = expenseOptionsResponseSchema.parse(
      (await call(api.app, 'get', `/groups/${group.id}/expense-options`, ana.cookies)).body,
    );
    const member = options.members[0];
    if (!member) throw new Error('no member');
    const description = 'Cena secreta de aniversario';
    const amount = '7654321';

    const response = await call(api.app, 'post', `/groups/${group.id}/expenses`, ana.cookies, {
      amount,
      currency: 'ARS',
      occurredAt: '2026-10-10T10:00:00.000Z',
      payerMemberId: member.id,
      categoryId: options.categories[0]?.id,
      description,
      split: { mode: 'equal', memberIds: [member.id] },
      payerAccount: {
        accountId: await newAccount(connection.pool, ana.id, false, 'ARS'),
        categoryId: await newCategory(connection.pool, ana.id, 'expense'),
      },
    });
    expect(response.status).toBe(201);
    const expense = groupExpenseResponseSchema.parse(response.body);

    const rows = await connection.pool.query<{
      action: string;
      member_id: string;
      created_at: Date;
    }>('select action, member_id, created_at from group_activity_log where subject_id = $1', [
      expense.id,
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ action: 'expense_created', member_id: member.id });
    expect(rows.rows[0]?.created_at.toISOString()).toBe('2026-10-10T12:00:00.000Z');

    const auditLines = api.logLines().filter((line) => line.includes('group expense created'));
    expect(auditLines).toHaveLength(1);
    const line = auditLines[0] ?? '';
    for (const id of [ana.id, group.id, expense.id]) expect(line).toContain(id);
    expect(line).toContain('requestId');

    const everything = api.logLines().join('\n');
    expect(everything).not.toContain(description);
    expect(everything).not.toContain(amount);
  });
});
