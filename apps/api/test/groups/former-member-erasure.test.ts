import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { eraseUserGroups } from '../../src/groups/infrastructure/db/erase-user-groups';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  insertSettlementSql,
  newRemovalWorld,
  sqlBalance,
  type RemovalWorld,
} from './member-removal-world';
import { equalSplit, insertExpensesSql } from './settlement-db-world';

let connection: DatabaseConnection;
let repository: DrizzleGroupRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGroupRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const erase = (userId: string) =>
  new DrizzleUserDeletionRepository(connection.db, [eraseUserGroups]).erase({
    userId,
    credentialsVersion: 0,
  });

const balances = async (w: RemovalWorld, memberId: string) => ({
  ARS: await sqlBalance(connection.pool, w.groupId, memberId, 'ARS'),
  USD: await sqlBalance(connection.pool, w.groupId, memberId, 'USD'),
});

async function seedHistory(w: RemovalWorld): Promise<void> {
  await insertExpensesSql(connection.pool, w, [
    {
      payer: w.beaMember,
      amount: 900_000n,
      currency: 'ARS',
      shares: equalSplit(900_000n, w.memberIds),
    },
    {
      payer: w.anaMember,
      amount: 5_001n,
      currency: 'USD',
      shares: equalSplit(5_001n, [w.anaMember, w.beaMember]),
    },
  ]);
  await insertSettlementSql(connection.pool, w, {
    from: w.ghostMember,
    to: w.beaMember,
    currency: 'ARS',
    amount: 100_000n,
  });
}

describe('account erasure of a group member (AC-20)', () => {
  it('keeps expenses, shares, settlements, legs and balances under a "Former member" ghost', async () => {
    const w = await newRemovalWorld(connection.db, connection.pool);
    await seedHistory(w);
    const before = await balances(w, w.beaMember);
    expect(before.ARS).not.toBe(0n);
    const counts = async () =>
      (
        await connection.pool.query<{ e: string; s: string; t: string; l: string }>(
          `select (select count(*) from group_expenses) as e,
                  (select count(*) from group_expense_shares) as s,
                  (select count(*) from group_settlements) as t,
                  (select count(*) from group_settlement_legs) as l`,
        )
      ).rows[0];
    const countsBefore = await counts();

    expect(await erase(w.beaUser)).toBe('erased');

    expect(await counts()).toEqual(countsBefore);
    expect(await balances(w, w.beaMember)).toEqual(before);
    const ghost = await repository.findMemberById(w.groupId, w.beaMember);
    expect(ghost).toMatchObject({ userId: null, displayName: 'Former member', role: 'member' });
    const settlement = await connection.pool.query<{ to_member_id: string }>(
      'select to_member_id from group_settlements',
    );
    expect(settlement.rows[0]?.to_member_id).toBe(w.beaMember);
  });

  it('erasing the admin account keeps the settlements of the group readable under the ghost', async () => {
    const w = await newRemovalWorld(connection.db, connection.pool);
    await seedHistory(w);

    await erase(w.anaUser);

    expect(
      Number(
        (await connection.pool.query<{ n: string }>('select count(*) as n from group_settlements'))
          .rows[0]?.n,
      ),
    ).toBe(1);
    expect((await repository.findMemberById(w.groupId, w.anaMember))?.displayName).toBe(
      'Former member',
    );
  });

  it('also covers a member who already left: the row keeps left_at and becomes the ghost', async () => {
    const w = await newRemovalWorld(connection.db, connection.pool);
    await insertExpensesSql(connection.pool, w, [
      {
        payer: w.beaMember,
        amount: 200n,
        currency: 'ARS',
        shares: equalSplit(200n, [w.beaMember]),
      },
    ]);
    const leftAt = new Date('2026-10-11T08:00:00.000Z');
    await repository.removeMember({ groupId: w.groupId, memberId: w.beaMember, leftAt });

    expect(await erase(w.beaUser)).toBe('erased');

    const detail = await repository.getGroup(w.groupId);
    expect(detail?.members.map((m) => m.id)).toEqual([w.anaMember, w.ghostMember]);
    expect(detail?.formerMembers).toEqual([
      { id: w.beaMember, displayName: 'Former member', leftAt },
    ]);
    expect(await balances(w, w.beaMember)).toEqual({ ARS: 0n, USD: 0n });
  });

  it('a user who left and rejoined keeps both rows through erasure (error-free, no duplicate)', async () => {
    const w = await newRemovalWorld(connection.db, connection.pool);
    await repository.removeMember({
      groupId: w.groupId,
      memberId: w.beaMember,
      leftAt: new Date('2026-10-11T08:00:00.000Z'),
    });
    await connection.pool.query('insert into group_members (group_id, user_id) values ($1, $2)', [
      w.groupId,
      w.beaUser,
    ]);

    expect(await erase(w.beaUser)).toBe('erased');

    const rows = await connection.pool.query<{ n: string }>(
      `select count(*) as n from group_members where group_id = $1 and display_name = 'Former member'`,
      [w.groupId],
    );
    expect(Number(rows.rows[0]?.n)).toBe(2);
  });
});
