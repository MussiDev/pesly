import { AppError, type SettlementSnapshot } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GroupRecordFormerMember,
  GroupSettlementConsolidated,
  settlementSnapshot,
  type GroupSettlement,
} from '../../src/groups';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { createAccountMovements } from '../../src/movements';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount } from '../movements/db-fixtures';
import {
  equalSplit,
  HOUR,
  insertExpensesSql,
  newDbWorld,
  NOW,
  plainSettlement,
  type DbWorld,
} from './settlement-db-world';

let connection: DatabaseConnection;
let repository: DrizzleGroupSettlementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGroupSettlementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

function world(ghosts = 2): Promise<DbWorld> {
  return newDbWorld(connection.db, connection.pool, { ghosts });
}

const LATER = new Date(NOW.getTime() + HOUR);

async function count(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where ${where}`,
    params,
  );
  return Number(result.rows[0]?.n);
}

async function balancesOf(w: DbWorld): Promise<Map<string, bigint>> {
  const sources = await repository.readBalanceSources(w.groupId);
  const result = new Map<string, bigint>();
  for (const currency of ['ARS', 'USD'] as const) {
    const { paid, shares, legs } = sources[currency];
    for (const id of w.memberIds) {
      const value = (paid.get(id) ?? 0n) - (shares.get(id) ?? 0n) + (legs.get(id) ?? 0n);
      result.set(`${currency}:${id}`, value);
    }
  }
  return result;
}

function updateData(
  w: DbWorld,
  saved: GroupSettlement,
  amount: bigint,
  occurredAt = saved.occurredAt,
): Parameters<DrizzleGroupSettlementRepository['updateSettlement']>[0] {
  const legs = [{ currency: saved.currency, amount }];
  return {
    groupId: w.groupId,
    settlementId: saved.id,
    amount,
    occurredAt,
    legs,
    activity: {
      action: 'settlement_updated',
      memberId: w.anaMember,
      createdAt: LATER,
      // The adapter rebuilds this under lock; a wrong value here must not reach the log.
      before: { ...settlementSnapshot(saved), amount: '1' },
      after: settlementSnapshot({ ...saved, amount, occurredAt, legs }),
    },
  };
}

function deleteData(
  w: DbWorld,
  saved: GroupSettlement,
): Parameters<DrizzleGroupSettlementRepository['deleteSettlement']>[0] {
  return {
    groupId: w.groupId,
    settlementId: saved.id,
    activity: {
      action: 'settlement_deleted',
      memberId: w.anaMember,
      createdAt: LATER,
      before: settlementSnapshot(saved),
      after: null,
    },
  };
}

interface LogRow {
  action: string;
  member_id: string;
  subject_id: string;
  created_at: Date;
  before: SettlementSnapshot | null;
  after: SettlementSnapshot | null;
}

async function logRows(groupId: string, action: string): Promise<LogRow[]> {
  const result = await connection.pool.query<LogRow>(
    'select action, member_id, subject_id, created_at, before, after from group_activity_log where group_id = $1 and action = $2 order by created_at, id',
    [groupId, action],
  );
  return result.rows;
}

async function consolidated(w: DbWorld): Promise<GroupSettlement> {
  const [ana, ghost] = [w.anaMember, w.memberIds[1] ?? ''];
  await insertExpensesSql(connection.pool, w, [
    {
      payer: ana,
      amount: 10_000n,
      currency: 'ARS',
      shares: [
        { memberId: ana, amount: 5_000n },
        { memberId: ghost, amount: 5_000n },
      ],
    },
    {
      payer: ghost,
      amount: 400n,
      currency: 'USD',
      shares: [
        { memberId: ana, amount: 300n },
        { memberId: ghost, amount: 100n },
      ],
    },
  ]);
  return repository.saveSettlement(
    plainSettlement(w, {
      fromMemberId: ghost,
      toMemberId: ana,
      currency: 'ARS',
      amount: 5_000n,
      legs: [
        { currency: 'ARS', amount: 5_000n },
        { currency: 'USD', amount: -300n },
      ],
      rate: { value: 10_000n, source: 'automatic', type: 'mep' },
    }),
  );
}

describe('updateSettlement', () => {
  it('moves the balances and the account balance and logs the stored before and after as integer strings', async () => {
    const w = await world();
    const ghost = w.memberIds[1] ?? '';
    const accountId = await newAccount(connection.pool, w.userId);
    await connection.pool.query('update group_members set user_id = $1 where id = $2', [
      w.userId,
      w.anaMember,
    ]);
    const saved = await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ghost,
        toMemberId: w.anaMember,
        amount: 2_500n,
        legs: [{ currency: 'ARS', amount: 2_500n }],
        account: { accountId, memberId: w.anaMember },
      }),
    );
    const accounts = createAccountMovements(connection.db);
    expect((await accounts.sumsByAccount([accountId])).get(accountId)).toBe(2_500n);

    const updated = await repository.updateSettlement(
      updateData(w, saved, 4_000n, new Date(NOW.getTime() - 5 * HOUR)),
    );

    expect(updated.amount).toBe(4_000n);
    expect(updated.occurredAt).toEqual(new Date(NOW.getTime() - 5 * HOUR));
    expect(updated.legs).toEqual([{ currency: 'ARS', amount: 4_000n }]);
    expect(await repository.getSettlement(w.groupId, saved.id)).toEqual(updated);
    expect((await balancesOf(w)).get(`ARS:${ghost}`)).toBe(4_000n);
    expect((await balancesOf(w)).get(`ARS:${w.anaMember}`)).toBe(-4_000n);
    expect((await accounts.sumsByAccount([accountId])).get(accountId)).toBe(4_000n);
    const [row] = await logRows(w.groupId, 'settlement_updated');
    expect(await count('group_activity_log', 'group_id = $1', [w.groupId])).toBe(2);
    expect(row?.member_id).toBe(w.anaMember);
    expect(row?.subject_id).toBe(saved.id);
    expect(row?.created_at).toEqual(LATER);
    expect(row?.before).toEqual(settlementSnapshot(saved));
    expect(row?.before?.amount).toBe('2500');
    expect(row?.after?.amount).toBe('4000');
    expect(row?.after?.legs).toEqual([{ currency: 'ARS', amount: '4000' }]);
  });

  it('changes only the date, with no balance change, even when a party has left', async () => {
    const w = await world();
    const saved = await repository.saveSettlement(plainSettlement(w));
    await connection.pool.query('update group_members set left_at = $1 where id = $2', [
      NOW,
      saved.fromMemberId,
    ]);

    const updated = await repository.updateSettlement(
      updateData(w, saved, saved.amount, new Date(NOW.getTime() - 9 * HOUR)),
    );

    expect(updated.amount).toBe(saved.amount);
    expect(updated.occurredAt).toEqual(new Date(NOW.getTime() - 9 * HOUR));
  });

  it('answers a 409 consolidated error for a consolidated settlement and changes nothing', async () => {
    const w = await world();
    const saved = await consolidated(w);
    const before = await balancesOf(w);

    const failure: unknown = await repository
      .updateSettlement(updateData(w, saved, 1n))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GroupSettlementConsolidated);
    expect(await repository.getSettlement(w.groupId, saved.id)).toEqual(saved);
    expect(await balancesOf(w)).toEqual(before);
    expect(await logRows(w.groupId, 'settlement_updated')).toHaveLength(0);
  });

  it('answers a 409 former member error when a party left and nothing changes', async () => {
    const w = await world();
    const saved = await repository.saveSettlement(plainSettlement(w));
    await connection.pool.query('update group_members set left_at = $1 where id = $2', [
      NOW,
      saved.fromMemberId,
    ]);

    const failure: unknown = await repository
      .updateSettlement(updateData(w, saved, 1_000n))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GroupRecordFormerMember);
    expect(await repository.getSettlement(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'settlement_updated')).toHaveLength(0);
  });

  it('leaves everything unchanged when the write fails after the log insert (error)', async () => {
    const w = await world();
    const saved = await repository.saveSettlement(plainSettlement(w));
    const failure = await withFailingLog('b4b_upd', () =>
      repository.updateSettlement(updateData(w, saved, 1_000n)).catch((error: unknown) => error),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect((failure as Error).message + String((failure as Error).cause)).toContain(
      'forced failure',
    );
    expect(await repository.getSettlement(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'settlement_updated')).toHaveLength(0);
  });

  it('answers a 404 for a missing settlement and for one of another group', async () => {
    const w = await world();
    const other = await world();
    const foreign = await repository.saveSettlement(plainSettlement(other));

    const missing: unknown = await repository
      .updateSettlement(updateData(w, { ...foreign, id: crypto.randomUUID() }, 1n))
      .catch((error: unknown) => error);
    const crossGroup: unknown = await repository
      .updateSettlement(updateData(w, foreign, 1n))
      .catch((error: unknown) => error);

    expect(missing).toBeInstanceOf(ResourceNotFound);
    expect(crossGroup).toBeInstanceOf(ResourceNotFound);
    expect(await repository.getSettlement(other.groupId, foreign.id)).toEqual(foreign);
  });
});

describe('deleteSettlement', () => {
  it('restores the balances and the account balance and logs the values it had (AC-06)', async () => {
    const w = await world();
    const ghost = w.memberIds[1] ?? '';
    const accountId = await newAccount(connection.pool, w.userId);
    await insertExpensesSql(connection.pool, w, [
      {
        payer: w.anaMember,
        amount: 9_000n,
        currency: 'ARS',
        shares: equalSplit(9_000n, w.memberIds),
      },
    ]);
    const start = await balancesOf(w);
    const saved = await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: ghost,
        toMemberId: w.anaMember,
        amount: 1_000n,
        legs: [{ currency: 'ARS', amount: 1_000n }],
        account: { accountId, memberId: w.anaMember },
      }),
    );
    const accounts = createAccountMovements(connection.db);
    expect((await accounts.sumsByAccount([accountId])).get(accountId)).toBe(1_000n);
    expect(await balancesOf(w)).not.toEqual(start);

    await repository.deleteSettlement(deleteData(w, saved));

    expect(await balancesOf(w)).toEqual(start);
    expect((await accounts.sumsByAccount([accountId])).get(accountId) ?? 0n).toBe(0n);
    expect(await repository.getSettlement(w.groupId, saved.id)).toBeNull();
    expect(await count('group_settlement_legs', 'settlement_id = $1', [saved.id])).toBe(0);
    const [row] = await logRows(w.groupId, 'settlement_deleted');
    expect(row?.subject_id).toBe(saved.id);
    expect(row?.created_at).toEqual(LATER);
    expect(row?.before).toEqual(settlementSnapshot(saved));
    expect(row?.before?.amount).toBe('1000');
    expect(row?.after).toBeNull();
    expect(await logRows(w.groupId, 'settlement_created')).toHaveLength(1);
  });

  it('deletes a consolidated settlement and restores both currencies', async () => {
    const w = await world();
    const saved = await consolidated(w);
    const settled = await balancesOf(w);
    expect([...settled.values()].every((value) => value === 0n)).toBe(true);

    await repository.deleteSettlement(deleteData(w, saved));

    expect(await repository.getSettlement(w.groupId, saved.id)).toBeNull();
    expect(await count('group_settlement_legs', 'settlement_id = $1', [saved.id])).toBe(0);
    // Both currencies are back to paid minus shares of the expenses alone.
    const restored = await balancesOf(w);
    expect(restored.get(`ARS:${w.anaMember}`)).toBe(5_000n);
    expect(restored.get(`ARS:${w.memberIds[1]}`)).toBe(-5_000n);
    expect(restored.get(`USD:${w.anaMember}`)).toBe(-300n);
    expect(restored.get(`USD:${w.memberIds[1]}`)).toBe(300n);
    const [row] = await logRows(w.groupId, 'settlement_deleted');
    expect(row?.before?.legs).toHaveLength(2);
  });

  it('answers a 409 former member error when a party left and nothing changes', async () => {
    const w = await world();
    const saved = await repository.saveSettlement(plainSettlement(w));
    await connection.pool.query('update group_members set left_at = $1 where id = $2', [
      NOW,
      saved.toMemberId,
    ]);

    const failure: unknown = await repository
      .deleteSettlement(deleteData(w, saved))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GroupRecordFormerMember);
    expect(await repository.getSettlement(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'settlement_deleted')).toHaveLength(0);
  });

  it('leaves everything unchanged when the write fails after the log insert (error)', async () => {
    const w = await world();
    const saved = await repository.saveSettlement(plainSettlement(w));
    const failure = await withFailingLog('b4b_del', () =>
      repository.deleteSettlement(deleteData(w, saved)).catch((error: unknown) => error),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(await repository.getSettlement(w.groupId, saved.id)).toEqual(saved);
    expect(await count('group_settlement_legs', 'settlement_id = $1', [saved.id])).toBe(1);
    expect(await logRows(w.groupId, 'settlement_deleted')).toHaveLength(0);
  });

  it('answers a 404 for a missing settlement and for one of another group', async () => {
    const w = await world();
    const other = await world();
    const foreign = await repository.saveSettlement(plainSettlement(other));

    const missing: unknown = await repository
      .deleteSettlement(deleteData(w, { ...foreign, id: crypto.randomUUID() }))
      .catch((error: unknown) => error);
    const crossGroup: unknown = await repository
      .deleteSettlement(deleteData(w, foreign))
      .catch((error: unknown) => error);

    expect(missing).toBeInstanceOf(ResourceNotFound);
    expect(crossGroup).toBeInstanceOf(ResourceNotFound);
    expect(await repository.getSettlement(other.groupId, foreign.id)).toEqual(foreign);
  });
});

describe('getSettlement', () => {
  it('returns the settlement with its legs, and null for another group or a missing id', async () => {
    const w = await world();
    const other = await world();
    const saved = await repository.saveSettlement(plainSettlement(w));

    expect(await repository.getSettlement(w.groupId, saved.id)).toEqual(saved);
    expect(await repository.getSettlement(other.groupId, saved.id)).toBeNull();
    expect(await repository.getSettlement(w.groupId, crypto.randomUUID())).toBeNull();
  });
});

/** A temporary trigger that fails every insert on the log, dropped afterwards. */
async function withFailingLog<T>(name: string, run: () => Promise<T>): Promise<T> {
  await connection.pool.query(`
    create function public.${name}() returns trigger language plpgsql
    as $$ begin raise exception 'forced failure'; end $$`);
  await connection.pool.query(`
    create trigger ${name} before insert on group_activity_log
    for each row execute function public.${name}()`);
  try {
    return await run();
  } finally {
    await connection.pool.query(`drop trigger ${name} on group_activity_log`);
    await connection.pool.query(`drop function public.${name}()`);
  }
}
