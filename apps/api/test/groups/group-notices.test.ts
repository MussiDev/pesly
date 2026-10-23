import { expenseOptionsResponseSchema, type GroupDetailResponse } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleGroupExpenseRepository, DrizzlePayerMovementRecorder } from '../../src/groups';
import { FanOutNotices } from '../../src/push/application/fan-out-notices';
import { DrizzlePushDeliveryQueue } from '../../src/push/infrastructure/db/drizzle-push-delivery-queue';
import { DrizzlePushFanOut } from '../../src/push/infrastructure/db/drizzle-push-fan-out';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
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

const OCCURRED_AT = '2026-10-10T10:00:00.000Z';

interface World {
  api: ReturnType<typeof setupGroupApi>;
  ana: TestUser;
  bob: TestUser;
  groupId: string;
  anaMember: string;
  bobMember: string;
  pedro: string;
  categoryId: string;
}

function memberIdOf(
  detail: GroupDetailResponse,
  predicate: (m: GroupDetailResponse['members'][number]) => boolean,
): string {
  const member = detail.members.find(predicate);
  if (!member) throw new Error('member not found');
  return member.id;
}

/** Ana (admin), Bob (member, display name "Bob") and the ghost Pedro, in the group "Casa". */
async function world(): Promise<World> {
  const api = setupGroupApi(connection);
  const ana = await api.makeUser('ana');
  const bob = await api.makeUser('bob');
  await connection.pool.query(`update users set display_name = 'Bob' where id = $1`, [bob.id]);
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
    pedro: (ghost.body as { id: string }).id,
    categoryId: options.categories[0]?.id ?? '',
  };
}

function expenseBody(w: World, payer: string, among: string[]): Record<string, unknown> {
  return {
    amount: '350000',
    currency: 'ARS',
    occurredAt: OCCURRED_AT,
    payerMemberId: payer,
    categoryId: w.categoryId,
    description: 'Supermercado Galicia',
    split: { mode: 'equal', memberIds: among },
  };
}

interface NoticeRow {
  owner_id: string;
  kind: string;
  payment_id: string;
  group_id: string | null;
  due_date: string;
  text: string;
}

async function noticesOf(userId: string): Promise<NoticeRow[]> {
  const result = await connection.pool.query<NoticeRow>(
    `select owner_id, kind, payment_id, group_id, due_date::text as due_date, text
     from notices where owner_id = $1 order by created_at, id`,
    [userId],
  );
  return result.rows;
}

async function allGroupNotices(): Promise<NoticeRow[]> {
  const result = await connection.pool.query<NoticeRow>(
    `select owner_id, kind, payment_id, group_id, due_date::text as due_date, text
     from notices where kind in ('group_expense', 'group_settlement')`,
  );
  return result.rows;
}

describe('group notices', () => {
  it('notifies the other registered members of an expense, but not the one who recorded it nor a ghost', async () => {
    const w = await world();

    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.bob.cookies,
      expenseBody(w, w.anaMember, [w.anaMember, w.bobMember, w.pedro]),
    );

    expect(response.status).toBe(201);
    const expenseId = (response.body as { id: string }).id;
    expect(await noticesOf(w.ana.id)).toEqual([
      {
        owner_id: w.ana.id,
        kind: 'group_expense',
        payment_id: expenseId,
        group_id: w.groupId,
        due_date: '2026-10-10',
        text: 'Bob agregó un gasto en Casa',
      },
    ]);
    expect(await noticesOf(w.bob.id)).toEqual([]);
    expect(await allGroupNotices()).toHaveLength(1);
  });

  it('keeps the amount and the description out of the notice text', async () => {
    const w = await world();

    await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.bob.cookies,
      expenseBody(w, w.anaMember, [w.anaMember, w.bobMember]),
    );

    const [notice] = await noticesOf(w.ana.id);
    expect(notice?.text).not.toMatch(/3500|350000|Supermercado|Galicia/);
  });

  it('notifies nobody who is not in the expense', async () => {
    const w = await world();

    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      expenseBody(w, w.pedro, [w.pedro, w.anaMember]),
    );

    expect(response.status).toBe(201);
    expect(await allGroupNotices()).toEqual([]);
  });

  it('writes the text in the language of each recipient and dates it in their time zone', async () => {
    const w = await world();
    await connection.pool.query(
      `update users set language = 'en', time_zone = 'America/Argentina/Buenos_Aires' where id = $1`,
      [w.ana.id],
    );
    // 01:00 UTC on the 11th is still the 10th in Buenos Aires.
    w.api.clock.advance(13 * 3_600_000);

    await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.bob.cookies,
      expenseBody(w, w.anaMember, [w.anaMember, w.bobMember]),
    );

    const [notice] = await noticesOf(w.ana.id);
    expect(notice?.text).toBe('Bob added an expense in Casa');
    expect(notice?.due_date).toBe('2026-10-10');
  });

  it('names a member with no display name generically', async () => {
    const w = await world();

    await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.ana.cookies,
      expenseBody(w, w.bobMember, [w.anaMember, w.bobMember]),
    );

    const [notice] = await noticesOf(w.bob.id);
    expect(notice?.text).toBe('Un integrante agregó un gasto en Casa');
  });

  it('leaves no notice when the expense is refused', async () => {
    const w = await world();

    const response = await call(w.api.app, 'post', `/groups/${w.groupId}/expenses`, w.bob.cookies, {
      ...expenseBody(w, w.anaMember, [w.anaMember, w.bobMember]),
      amount: '0',
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await allGroupNotices()).toEqual([]);
  });

  it('notifies the other side of a settlement', async () => {
    const w = await world();

    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      {
        kind: 'single',
        fromMemberId: w.bobMember,
        toMemberId: w.anaMember,
        currency: 'ARS',
        amount: '100000',
        occurredAt: OCCURRED_AT,
      },
    );

    expect(response.status).toBe(201);
    const settlementId = (response.body as { id: string }).id;
    expect(await noticesOf(w.bob.id)).toEqual([
      {
        owner_id: w.bob.id,
        kind: 'group_settlement',
        payment_id: settlementId,
        group_id: w.groupId,
        due_date: '2026-10-10',
        text: 'Un integrante registró un pago en Casa',
      },
    ]);
    expect(await noticesOf(w.ana.id)).toEqual([]);
  });

  it('notifies nobody when the repository has no renderer', async () => {
    const w = await world();
    const repository = new DrizzleGroupExpenseRepository(
      connection.db,
      new DrizzlePayerMovementRecorder(connection.db, w.api.clock),
    );

    await repository.saveExpense({
      groupId: w.groupId,
      payerMemberId: w.anaMember,
      createdByMemberId: w.bobMember,
      amount: 1000n,
      currency: 'ARS',
      occurredAt: new Date(OCCURRED_AT),
      categoryId: w.categoryId,
      description: 'x',
      splitMode: 'equal',
      shares: [
        { memberId: w.anaMember, amount: 500n, basisPoints: null },
        { memberId: w.bobMember, amount: 500n, basisPoints: null },
      ],
      activity: {
        action: 'expense_created',
        memberId: w.bobMember,
        createdAt: w.api.clock.now(),
        fromMovement: false,
      },
      payerMovement: null,
      adoptedMovement: null,
    });

    expect(await allGroupNotices()).toEqual([]);
  });

  it('pushes a group notice to the recipient devices with the group id', async () => {
    const w = await world();
    await connection.pool.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)`,
      [w.ana.id, 'https://fcm.googleapis.com/fcm/send/ana', 'p'.repeat(87), 'a'.repeat(22)],
    );
    await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/expenses`,
      w.bob.cookies,
      expenseBody(w, w.anaMember, [w.anaMember, w.bobMember]),
    );
    const now = new Date();

    const fanOut = await new FanOutNotices(new DrizzlePushFanOut(connection.db), {
      now: () => now,
    }).execute();
    const claimed = await new DrizzlePushDeliveryQueue(connection.db).claimDue(now, 10);

    expect(fanOut.deliveries).toBe(1);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      noticeKind: 'group_expense',
      noticeOwnerId: w.ana.id,
      noticeGroupId: w.groupId,
      noticeText: 'Bob agregó un gasto en Casa',
    });
  });
});
