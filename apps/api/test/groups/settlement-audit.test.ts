import { settlementResponseSchema } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { call, createGroup, invitationTokenOf, readGroup, setupGroupApi } from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function twoMembers() {
  const api = setupGroupApi(connection);
  const ana = await api.makeUser('ana');
  const bob = await api.makeUser('bob');
  const group = await createGroup(api.app, ana);
  const joined = await call(api.app, 'post', '/groups/join', bob.cookies, {
    token: await invitationTokenOf(api.app, ana, group.id),
  });
  expect(joined.status).toBe(200);
  const detail = await readGroup(api.app, ana, group.id);
  const anaMember = detail.members.find((m) => m.role === 'admin')?.id ?? '';
  const bobMember = detail.members.find((m) => m.role === 'member')?.id ?? '';
  return { api, ana, bob, group, anaMember, bobMember };
}

describe('settlement audit trail (AC-22)', () => {
  it('adds a log row and an audit line with ids only, never an amount', async () => {
    const w = await twoMembers();
    const amount = '7654321';

    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.group.id}/settlements`,
      w.ana.cookies,
      {
        kind: 'single',
        fromMemberId: w.anaMember,
        toMemberId: w.bobMember,
        currency: 'ARS',
        amount,
        occurredAt: '2026-10-10T10:00:00.000Z',
      },
    );
    expect(response.status).toBe(201);
    const settlement = settlementResponseSchema.parse(response.body);

    const rows = await connection.pool.query<{
      action: string;
      member_id: string;
      created_at: Date;
    }>('select action, member_id, created_at from group_activity_log where subject_id = $1', [
      settlement.id,
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ action: 'settlement_created', member_id: w.anaMember });
    expect(rows.rows[0]?.created_at.toISOString()).toBe('2026-10-10T12:00:00.000Z');

    const auditLines = w.api.logLines().filter((line) => line.includes('group settlement created'));
    expect(auditLines).toHaveLength(1);
    const line = auditLines[0] ?? '';
    for (const id of [w.ana.id, w.group.id, settlement.id]) expect(line).toContain(id);
    expect(line).toContain('requestId');
    expect(w.api.logLines().join('\n')).not.toContain(amount);
  });

  it('audits a removal and a leave with ids only and no amount, balance included', async () => {
    const w = await twoMembers();

    const removed = await call(
      w.api.app,
      'delete',
      `/groups/${w.group.id}/members/${w.bobMember}`,
      w.ana.cookies,
    );
    expect(removed.status).toBe(204);
    const removal = w.api.logLines().filter((line) => line.includes('group member removed'));
    expect(removal).toHaveLength(1);
    for (const id of [w.ana.id, w.group.id, w.bobMember]) expect(removal[0]).toContain(id);
    expect(removal[0]).toContain('requestId');

    const carol = await w.api.makeUser('carol');
    await call(w.api.app, 'post', '/groups/join', carol.cookies, {
      token: await invitationTokenOf(w.api.app, w.ana, w.group.id),
    });
    const detail = await readGroup(w.api.app, w.ana, w.group.id);
    const carolMember = detail.members.find((m) => m.role === 'member')?.id ?? '';
    const left = await call(w.api.app, 'post', `/groups/${w.group.id}/leave`, carol.cookies);
    expect(left.status).toBe(204);
    const leaving = w.api.logLines().filter((line) => line.includes('group member left'));
    expect(leaving).toHaveLength(1);
    for (const id of [carol.id, w.group.id, carolMember]) expect(leaving[0]).toContain(id);
  });

  it('keeps the balance out of the logs when a removal is refused with 409', async () => {
    const w = await twoMembers();
    const options = await call(
      w.api.app,
      'get',
      `/groups/${w.group.id}/expense-options`,
      w.ana.cookies,
    );
    const categoryId = (options.body as { categories: { id: string }[] }).categories[0]?.id;
    const expense = await call(w.api.app, 'post', `/groups/${w.group.id}/expenses`, w.bob.cookies, {
      amount: '9876544',
      currency: 'ARS',
      occurredAt: '2026-10-10T10:00:00.000Z',
      payerMemberId: w.anaMember,
      categoryId,
      description: 'Gasto',
      split: { mode: 'equal', memberIds: [w.anaMember, w.bobMember] },
    });
    expect(expense.status).toBe(201);

    const response = await call(
      w.api.app,
      'delete',
      `/groups/${w.group.id}/members/${w.bobMember}`,
      w.ana.cookies,
    );

    expect(response.status).toBe(409);
    const everything = w.api.logLines().join('\n');
    expect(everything).not.toContain('4938272');
    expect(everything).not.toContain('9876544');
  });
});
