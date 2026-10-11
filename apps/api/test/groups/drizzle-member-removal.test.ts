import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GroupAlreadyMember,
  GroupLastAdmin,
  GroupMemberHasBalance,
  GroupMemberLimitReached,
  MAX_GROUP_MEMBERS,
  type NewGroupExpense,
} from '../../src/groups';
import { TokenInvalid } from '../../src/groups/domain/errors';
import { DrizzleGroupExpenseRepository } from '../../src/groups/infrastructure/db/drizzle-group-expense-repository';
import { DrizzleGroupMembershipReader } from '../../src/groups/infrastructure/db/drizzle-group-membership-reader';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { RandomTokenSource } from '../../src/groups/infrastructure/crypto/random-token-source';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';
import {
  insertSettlementSql,
  newRemovalWorld,
  sqlBalance,
  type RemovalWorld,
} from './member-removal-world';
import { equalSplit, insertExpensesSql } from './settlement-db-world';

let connection: DatabaseConnection;
let repository: DrizzleGroupRepository;
let reader: DrizzleGroupMembershipReader;
const tokens = new RandomTokenSource();

const NOW = new Date('2026-10-10T12:00:00.000Z');
const LEFT_AT = new Date('2026-10-11T08:00:00.000Z');
const WEEK = 7 * 24 * 60 * 60 * 1000;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGroupRepository(connection.db);
  reader = new DrizzleGroupMembershipReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const world = () => newRemovalWorld(connection.db, connection.pool);

async function scalar(statement: string, params: unknown[]): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
}

const remove = (w: RemovalWorld, memberId: string) =>
  repository.removeMember({ groupId: w.groupId, memberId, leftAt: LEFT_AT });

const leftAtOf = async (memberId: string): Promise<Date | null> => {
  const result = await connection.pool.query<{ left_at: Date | null }>(
    'select left_at from group_members where id = $1',
    [memberId],
  );
  return result.rows[0]?.left_at ?? null;
};

/** Ana pays 3,000.00 ARS split with Bea, and Bea pays her 1,500.00 back: both end at 0. */
async function settleBea(w: RemovalWorld): Promise<void> {
  await insertExpensesSql(connection.pool, w, [
    {
      payer: w.anaMember,
      amount: 300_000n,
      currency: 'ARS',
      shares: equalSplit(300_000n, [w.anaMember, w.beaMember]),
    },
  ]);
  await insertSettlementSql(connection.pool, w, {
    from: w.beaMember,
    to: w.anaMember,
    currency: 'ARS',
    amount: 150_000n,
  });
}

async function invite(w: RemovalWorld, memberId: string) {
  const token = tokens.generate();
  await repository.upsertInvitation({
    groupId: w.groupId,
    memberId,
    tokenHash: token.hash,
    expiresAt: new Date(NOW.getTime() + WEEK),
  });
  return token;
}

describe('removeMember', () => {
  it('sets left_at at balance 0, keeps expenses and shares, drops invitation and claim link', async () => {
    const w = await world();
    await settleBea(w);
    await invite(w, w.beaMember);
    await repository.replaceClaimLink({
      groupId: w.groupId,
      memberId: w.ghostMember,
      tokenHash: tokens.generate().hash,
    });
    const sharesBefore = await scalar(
      'select count(*) as n from group_expense_shares where member_id = $1',
      [w.beaMember],
    );

    const removed = await remove(w, w.beaMember);

    expect(removed).toMatchObject({ id: w.beaMember, userId: w.beaUser, role: 'member' });
    expect(await leftAtOf(w.beaMember)).toEqual(LEFT_AT);
    expect(await scalar('select count(*) as n from group_expenses', [])).toBe(1);
    expect(
      await scalar('select count(*) as n from group_expense_shares where member_id = $1', [
        w.beaMember,
      ]),
    ).toBe(sharesBefore);
    expect(
      await scalar('select count(*) as n from group_invitations where created_by_member_id = $1', [
        w.beaMember,
      ]),
    ).toBe(0);

    await remove(w, w.ghostMember);
    expect(
      await scalar('select count(*) as n from group_claim_links where member_id = $1', [
        w.ghostMember,
      ]),
    ).toBe(0);
  });

  it('answers 409 GROUP_MEMBER_HAS_BALANCE with the signed balances and changes nothing', async () => {
    const w = await world();
    await insertExpensesSql(connection.pool, w, [
      {
        payer: w.anaMember,
        amount: 300_001n,
        currency: 'ARS',
        shares: equalSplit(300_001n, [w.anaMember, w.beaMember]),
      },
    ]);
    await invite(w, w.beaMember);

    const error: unknown = await remove(w, w.beaMember).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GroupMemberHasBalance);
    expect((error as GroupMemberHasBalance).details).toEqual({ ARS: '-150000', USD: '0' });
    expect(await leftAtOf(w.beaMember)).toBeNull();
    expect(
      await scalar('select count(*) as n from group_invitations where created_by_member_id = $1', [
        w.beaMember,
      ]),
    ).toBe(1);
  });

  it('counts a USD balance and a settlement leg owed to the member as a balance (conflict)', async () => {
    const w = await world();
    await insertSettlementSql(connection.pool, w, {
      from: w.anaMember,
      to: w.beaMember,
      currency: 'USD',
      amount: 500n,
    });

    const error: unknown = await remove(w, w.beaMember).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GroupMemberHasBalance);
    expect((error as GroupMemberHasBalance).details).toEqual({ ARS: '0', USD: '-500' });
    expect(await leftAtOf(w.beaMember)).toBeNull();
  });

  it('keeps bigint precision above 2^53 in the balances', async () => {
    const w = await world();
    const big = 9_007_199_254_740_993n;
    await insertExpensesSql(connection.pool, w, [
      {
        payer: w.beaMember,
        amount: big,
        currency: 'ARS',
        shares: [{ memberId: w.anaMember, amount: big }],
      },
    ]);

    const error: unknown = await remove(w, w.beaMember).catch((e: unknown) => e);

    expect((error as GroupMemberHasBalance).details).toEqual({ ARS: big.toString(), USD: '0' });
  });

  it('removing a member who is not in the group, or already left, is a 404 ResourceNotFound error', async () => {
    const w = await world();
    const other = await world();

    await expect(remove(w, other.beaMember)).rejects.toBeInstanceOf(ResourceNotFound);
    await remove(w, w.ghostMember);
    await expect(remove(w, w.ghostMember)).rejects.toBeInstanceOf(ResourceNotFound);
    expect(await leftAtOf(other.beaMember)).toBeNull();
  });

  it('removing the last admin while others remain is a 409 GROUP_LAST_ADMIN conflict and changes nothing', async () => {
    const w = await world();
    await invite(w, w.anaMember);

    await expect(remove(w, w.anaMember)).rejects.toBeInstanceOf(GroupLastAdmin);

    expect(await leftAtOf(w.anaMember)).toBeNull();
    expect(
      await scalar('select count(*) as n from group_invitations where created_by_member_id = $1', [
        w.anaMember,
      ]),
    ).toBe(1);
  });

  it('lets an admin leave when another active admin exists, and a sole member leave', async () => {
    const w = await world();
    await repository.setAdmin(w.groupId, w.beaMember);
    await remove(w, w.anaMember);
    expect(await leftAtOf(w.anaMember)).toEqual(LEFT_AT);

    await remove(w, w.ghostMember);
    // Bea is now the sole active member and the only admin.
    await remove(w, w.beaMember);
    expect(await leftAtOf(w.beaMember)).toEqual(LEFT_AT);
  });

  it('checks the balance before the last-admin rule', async () => {
    const w = await world();
    await insertExpensesSql(connection.pool, w, [
      {
        payer: w.anaMember,
        amount: 100n,
        currency: 'ARS',
        shares: equalSplit(100n, [w.beaMember, w.ghostMember]),
      },
    ]);

    await expect(remove(w, w.anaMember)).rejects.toBeInstanceOf(GroupMemberHasBalance);
  });

  it('resets a percentage default split that contains the removed member to equal', async () => {
    const w = await world();
    await connection.pool.query(
      `update groups set default_split_mode = 'percentage' where id = $1`,
      [w.groupId],
    );
    await connection.pool.query(
      `insert into group_default_split_shares (group_id, member_id, basis_points)
       values ($1, $2, 6000), ($1, $3, 4000)`,
      [w.groupId, w.anaMember, w.beaMember],
    );

    await remove(w, w.beaMember);

    const mode = await connection.pool.query<{ default_split_mode: string }>(
      'select default_split_mode from groups where id = $1',
      [w.groupId],
    );
    expect(mode.rows[0]?.default_split_mode).toBe('equal');
    expect(
      await scalar('select count(*) as n from group_default_split_shares where group_id = $1', [
        w.groupId,
      ]),
    ).toBe(0);
  });

  it('keeps a percentage default split that does not contain the removed member', async () => {
    const w = await world();
    await connection.pool.query(
      `update groups set default_split_mode = 'percentage' where id = $1`,
      [w.groupId],
    );
    await connection.pool.query(
      `insert into group_default_split_shares (group_id, member_id, basis_points)
       values ($1, $2, 6000), ($1, $3, 4000)`,
      [w.groupId, w.anaMember, w.beaMember],
    );

    await remove(w, w.ghostMember);

    expect(
      await scalar('select count(*) as n from group_default_split_shares where group_id = $1', [
        w.groupId,
      ]),
    ).toBe(2);
  });

  it('a database error inside the transaction rolls every change back and leaves the member active', async () => {
    const w = await world();
    await invite(w, w.beaMember);
    await connection.pool.query(
      `update groups set default_split_mode = 'percentage' where id = $1`,
      [w.groupId],
    );
    await connection.pool.query(
      `insert into group_default_split_shares (group_id, member_id, basis_points)
       values ($1, $2, 5000), ($1, $3, 5000)`,
      [w.groupId, w.anaMember, w.beaMember],
    );
    // Fails only for this member's invitation, which the removal deletes after setting left_at.
    const suffix = w.beaMember.replaceAll('-', '');
    await connection.pool.query(`
      create function fail_removal_${suffix}() returns trigger language plpgsql as $$
      begin
        if old.created_by_member_id = '${w.beaMember}' then raise exception 'forced failure'; end if;
        return old;
      end $$`);
    await connection.pool.query(`
      create trigger fail_removal_${suffix} before delete on group_invitations
      for each row execute function fail_removal_${suffix}()`);

    try {
      const error: unknown = await remove(w, w.beaMember).catch((e: unknown) => e);
      expect((error as Error).cause).toMatchObject({
        message: expect.stringMatching(/forced failure/) as unknown,
      });
    } finally {
      await connection.pool.query(`drop trigger fail_removal_${suffix} on group_invitations`);
      await connection.pool.query(`drop function fail_removal_${suffix}()`);
    }

    expect(await leftAtOf(w.beaMember)).toBeNull();
    expect(
      await scalar('select count(*) as n from group_invitations where created_by_member_id = $1', [
        w.beaMember,
      ]),
    ).toBe(1);
    expect(
      await scalar('select count(*) as n from group_default_split_shares where group_id = $1', [
        w.groupId,
      ]),
    ).toBe(2);
    expect(await repository.findMember(w.groupId, w.beaUser)).not.toBeNull();
  });
});

describe('a member who left', () => {
  it('is not found by findMember, findMemberById, getSummary, listForUser or the reader, and is a former member', async () => {
    const w = await world();
    await remove(w, w.beaMember);

    expect(await repository.findMember(w.groupId, w.beaUser)).toBeNull();
    expect(await repository.findMemberById(w.groupId, w.beaMember)).toBeNull();
    expect(await repository.getSummary(w.groupId, w.beaUser)).toBeNull();
    expect(await repository.listForUser(w.beaUser)).toEqual([]);
    expect(await reader.groupIdsOf(w.beaUser)).toEqual([]);
    expect(await reader.groupIdsOf(w.anaUser)).toEqual([w.groupId]);
    expect(await repository.getSummary(w.groupId, w.anaUser)).toMatchObject({ memberCount: 2 });

    const detail = await repository.getGroup(w.groupId);
    expect(detail?.members.map((m) => m.id)).toEqual([w.anaMember, w.ghostMember]);
    expect(detail?.formerMembers).toEqual([
      { id: w.beaMember, displayName: null, leftAt: LEFT_AT },
    ]);
  });

  it('keeps the profile name of a registered former member and the stored name of a ghost', async () => {
    const w = await world();
    await connection.pool.query('update users set display_name = $2 where id = $1', [
      w.beaUser,
      'Bea Perez',
    ]);
    await remove(w, w.beaMember);
    await remove(w, w.ghostMember);

    const detail = await repository.getGroup(w.groupId);

    expect(detail?.formerMembers.map((m) => m.displayName).sort()).toEqual(['Bea Perez', 'Pedro']);
  });

  it('cannot be made admin, claimed or counted: setAdmin answers null for a left member', async () => {
    const w = await world();
    await remove(w, w.ghostMember);

    expect(await repository.setAdmin(w.groupId, w.ghostMember)).toBeNull();
  });

  it('rejoins through an invitation with a NEW member row; the old row stays', async () => {
    const w = await world();
    await remove(w, w.beaMember);
    const token = await invite(w, w.anaMember);

    const rejoined = await repository.acceptInvitation({
      tokenHash: token.hash,
      userId: w.beaUser,
      now: NOW,
      limit: MAX_GROUP_MEMBERS,
    });

    expect(rejoined.id).not.toBe(w.beaMember);
    expect(await repository.findMember(w.groupId, w.beaUser)).toMatchObject({ id: rejoined.id });
    expect(await leftAtOf(w.beaMember)).toEqual(LEFT_AT);
    const detail = await repository.getGroup(w.groupId);
    expect(detail?.formerMembers.map((m) => m.id)).toEqual([w.beaMember]);
    expect(await reader.groupIdsOf(w.beaUser)).toEqual([w.groupId]);
  });

  it('an active member still gets a duplicate-member conflict when accepting again', async () => {
    const w = await world();
    const token = await invite(w, w.anaMember);

    await expect(
      repository.acceptInvitation({
        tokenHash: token.hash,
        userId: w.beaUser,
        now: NOW,
        limit: MAX_GROUP_MEMBERS,
      }),
    ).rejects.toBeInstanceOf(GroupAlreadyMember);
  });

  it('counts only active members against the 50 member limit', async () => {
    const w = await world();
    await connection.pool.query(
      `insert into group_members (group_id, display_name)
       select $1, 'Ghost ' || g from generate_series(1, $2::int) g`,
      [w.groupId, MAX_GROUP_MEMBERS - 4],
    );
    const token = await invite(w, w.anaMember);
    const newcomer = await newUserId(connection.db);
    await expect(
      repository.acceptInvitation({
        tokenHash: token.hash,
        userId: newcomer,
        now: NOW,
        limit: MAX_GROUP_MEMBERS,
      }),
    ).resolves.toBeDefined();
    // 50 active now: adding a ghost is a limit conflict, even with a former row around.
    await expect(
      repository.addGhost({ groupId: w.groupId, displayName: 'Extra', limit: MAX_GROUP_MEMBERS }),
    ).rejects.toBeInstanceOf(GroupMemberLimitReached);

    await remove(w, w.ghostMember);

    await expect(
      repository.addGhost({ groupId: w.groupId, displayName: 'Extra', limit: MAX_GROUP_MEMBERS }),
    ).resolves.toBeDefined();
    expect((await repository.getSummary(w.groupId, w.anaUser))?.memberCount).toBe(
      MAX_GROUP_MEMBERS,
    );
  });
});

describe('removal against a concurrent expense', () => {
  it('serialises: the removal fails with the balance or the expense fails, never both applied', async () => {
    const expenses = new DrizzleGroupExpenseRepository(
      connection.db,
      new DrizzlePayerMovementRecorder(connection.db, { now: () => NOW }),
    );
    for (let round = 0; round < 12; round += 1) {
      const w = await world();
      const expense: NewGroupExpense = {
        groupId: w.groupId,
        payerMemberId: w.beaMember,
        createdByMemberId: w.beaMember,
        amount: 100_000n,
        currency: 'ARS',
        occurredAt: new Date(NOW.getTime() - 1000),
        categoryId: w.categoryId,
        description: 'Race',
        splitMode: 'equal',
        shares: [
          { memberId: w.anaMember, amount: 50_000n, basisPoints: null },
          { memberId: w.beaMember, amount: 50_000n, basisPoints: null },
        ],
        activity: { action: 'expense_created', memberId: w.beaMember, createdAt: NOW },
        payerMovement: null,
      };

      const [removal, saved] = await Promise.allSettled([
        remove(w, w.beaMember),
        expenses.saveExpense(expense),
      ]);

      const left = (await leftAtOf(w.beaMember)) !== null;
      const stored = await scalar('select count(*) as n from group_expenses where group_id = $1', [
        w.groupId,
      ]);
      if (left) {
        // Removed first: the expense was refused and the balance stayed 0.
        expect(removal.status).toBe('fulfilled');
        expect(saved.status).toBe('rejected');
        expect(stored).toBe(0);
        expect(await sqlBalance(connection.pool, w.groupId, w.beaMember, 'ARS')).toBe(0n);
      } else {
        // Expense first: the removal saw the balance and refused.
        expect(saved.status).toBe('fulfilled');
        expect(removal.status).toBe('rejected');
        expect(removal.status === 'rejected' && removal.reason).toBeInstanceOf(
          GroupMemberHasBalance,
        );
        expect(stored).toBe(1);
      }
    }
  });
});

interface ErrorWithCode {
  code?: string;
  cause?: { code?: string };
}

describe('removal against a concurrent claim or link replacement of the same ghost', () => {
  const ROUNDS = 25;
  const unusedLinks = (memberId: string) =>
    scalar('select count(*) as n from group_claim_links where member_id = $1 and used_at is null', [
      memberId,
    ]);
  /** drizzle wraps the driver error, so the SQLSTATE sits on `cause`. */
  const noDeadlock = (result: PromiseSettledResult<unknown>) => {
    const reason = result.status === 'rejected' ? (result.reason as ErrorWithCode) : null;
    expect(reason?.code).not.toBe('40P01');
    expect(reason?.cause?.code).not.toBe('40P01');
  };

  it('never deadlocks and leaves no usable link on a ghost who left (claim)', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const w = await world();
      const token = tokens.generate();
      await repository.replaceClaimLink({
        groupId: w.groupId,
        memberId: w.ghostMember,
        tokenHash: token.hash,
      });
      const claimer = await newUserId(connection.db);

      const [removal, claim] = await Promise.allSettled([
        remove(w, w.ghostMember),
        repository.claimGhost({ tokenHash: token.hash, userId: claimer, now: NOW }),
      ]);

      noDeadlock(removal);
      noDeadlock(claim);
      expect(removal.status).toBe('fulfilled');
      expect(await leftAtOf(w.ghostMember)).not.toBeNull();
      expect(await unusedLinks(w.ghostMember)).toBe(0);
      const owner = await connection.pool.query<{ user_id: string | null }>(
        'select user_id from group_members where id = $1',
        [w.ghostMember],
      );
      expect(owner.rows[0]?.user_id ?? null).toBe(claim.status === 'fulfilled' ? claimer : null);
      if (claim.status === 'rejected') expect(claim.reason).toBeInstanceOf(TokenInvalid);
    }
  });

  it('never deadlocks and leaves no usable link on a ghost who left (replace link)', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const w = await world();
      await repository.replaceClaimLink({
        groupId: w.groupId,
        memberId: w.ghostMember,
        tokenHash: tokens.generate().hash,
      });

      const [removal, replaced] = await Promise.allSettled([
        remove(w, w.ghostMember),
        repository.replaceClaimLink({
          groupId: w.groupId,
          memberId: w.ghostMember,
          tokenHash: tokens.generate().hash,
        }),
      ]);

      noDeadlock(removal);
      noDeadlock(replaced);
      expect(removal.status).toBe('fulfilled');
      if (replaced.status === 'rejected') expect(replaced.reason).toBeInstanceOf(ResourceNotFound);
      expect(await leftAtOf(w.ghostMember)).not.toBeNull();
      expect(await unusedLinks(w.ghostMember)).toBe(0);
    }
  });
});
