import { randomUUID } from 'node:crypto';
import { AppError } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  balancesByCurrency,
  computeBalances,
  consolidate,
  GroupSettlementMemberInvalid,
  GroupSettlementStale,
  GroupSplitMemberInvalid,
  pairLegs,
  SettlementAmountNotPositive,
  SettlementRateNotPositive,
  type GroupSettlement,
  type NewGroupSettlement,
} from '../../src/groups';
import { DrizzleGroupExpenseRepository } from '../../src/groups/infrastructure/db/drizzle-group-expense-repository';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';
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
let expenses: DrizzleGroupExpenseRepository;
let groupsRepo: DrizzleGroupRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGroupSettlementRepository(connection.db);
  groupsRepo = new DrizzleGroupRepository(connection.db);
  expenses = new DrizzleGroupExpenseRepository(
    connection.db,
    new DrizzlePayerMovementRecorder(connection.db, { now: () => NOW }),
  );
});

afterAll(async () => {
  await connection.pool.end();
});

function world(ghosts = 3): Promise<DbWorld> {
  return newDbWorld(connection.db, connection.pool, { ghosts });
}

async function count(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where ${where}`,
    params,
  );
  return Number(result.rows[0]?.n);
}

function pending<T>(promise: Promise<T>, ms = 300): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => false,
      () => false,
    ),
    new Promise<boolean>((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, ms),
    ),
  ]);
}

describe('saveSettlement', () => {
  it('persists the settlement, its legs and the log row together and reads them back', async () => {
    const w = await world();
    const accountOwner = await connection.pool.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       values ($1, 'Caja', 'cash', 'ARS', 0, true) returning id`,
      [w.userId],
    );
    const accountId = accountOwner.rows[0]?.id ?? '';

    const saved = await repository.saveSettlement(
      plainSettlement(w, { account: { accountId, memberId: w.anaMember } }),
    );

    expect(saved).toMatchObject({
      groupId: w.groupId,
      fromMemberId: w.memberIds[1],
      toMemberId: w.anaMember,
      currency: 'ARS',
      amount: 3_000_000n,
      legs: [{ currency: 'ARS', amount: 3_000_000n }],
      accountId,
      accountMemberId: w.anaMember,
      rate: null,
      rateSource: null,
      rateType: null,
    });
    const page = await repository.listSettlements(w.groupId, { limit: 10 });
    expect(page.items).toEqual([saved]);
    const log = await connection.pool.query<{
      member_id: string;
      action: string;
      subject_id: string;
      created_at: Date;
    }>('select * from group_activity_log where group_id = $1', [w.groupId]);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({
      member_id: w.anaMember,
      action: 'settlement_created',
      subject_id: saved.id,
    });
    expect(log.rows[0]?.created_at.toISOString()).toBe(NOW.toISOString());
  });

  it('stores the rate of a consolidated settlement with both legs and no legs mix-up', async () => {
    const w = await world();
    const [a, b] = [w.memberIds[1] ?? '', w.anaMember];
    const result = consolidate(a, b, { ARS: 50_000_000n, USD: -10_000n }, 'USD', 10_000_000n);

    const saved = await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: result.fromMemberId,
        toMemberId: result.toMemberId,
        currency: result.currency,
        amount: result.amount,
        legs: result.legs,
        rate: { value: 10_000_000n, source: 'automatic', type: 'mep' },
      }),
    );

    expect(saved.rate).toBe(10_000_000n);
    expect(saved.rateSource).toBe('automatic');
    expect(saved.rateType).toBe('mep');
    expect(saved.legs).toHaveLength(2);
    expect(saved.legs).toEqual(
      expect.arrayContaining([
        { currency: 'ARS', amount: 50_000_000n },
        { currency: 'USD', amount: -10_000n },
      ]),
    );
    expect((await repository.listSettlements(w.groupId, { limit: 1 })).items[0]).toEqual(saved);
  });

  it('leaves nothing behind when the write fails after the leg insert', async () => {
    const w = await world();
    await connection.pool.query(`
      create function public.b4_forced_failure() returns trigger language plpgsql
      as $$ begin raise exception 'forced failure'; end $$`);
    await connection.pool.query(`
      create trigger b4_forced_failure before insert on group_activity_log
      for each row execute function public.b4_forced_failure()`);
    let failure: unknown;
    try {
      failure = await repository.saveSettlement(plainSettlement(w)).catch((e: unknown) => e);
    } finally {
      await connection.pool.query('drop trigger b4_forced_failure on group_activity_log');
      await connection.pool.query('drop function public.b4_forced_failure()');
    }

    // Any other database failure is rethrown as it is, with no typed error (sad path).
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect((failure as Error).message + String((failure as Error).cause)).toContain(
      'forced failure',
    );
    expect(await count('group_settlements')).toBe(0);
    expect(await count('group_settlement_legs')).toBe(0);
    expect(await count('group_activity_log')).toBe(0);
  });

  it('rethrows a database failure that is not a constraint of the caller, as it is (sad path error)', async () => {
    const w = await world();

    const failure: unknown = await repository
      .saveSettlement(plainSettlement(w, { amount: 2n ** 70n, legs: [] }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(await count('group_settlements')).toBe(0);
  });

  it('maps unique, check and foreign-key violations to typed errors (sad path invalid)', async () => {
    const w = await world();
    const other = await world();
    const same = w.anaMember;

    await expect(
      repository.saveSettlement(plainSettlement(w, { fromMemberId: same, toMemberId: same })),
    ).rejects.toBeInstanceOf(GroupSettlementMemberInvalid);
    await expect(
      repository.saveSettlement(plainSettlement(w, { fromMemberId: other.anaMember })),
    ).rejects.toBeInstanceOf(GroupSettlementMemberInvalid);
    await expect(
      repository.saveSettlement(plainSettlement(w, { toMemberId: randomUUID() })),
    ).rejects.toBeInstanceOf(GroupSettlementMemberInvalid);
    await expect(
      repository.saveSettlement(
        plainSettlement(w, { amount: 0n, legs: [{ currency: 'ARS', amount: 1n }] }),
      ),
    ).rejects.toBeInstanceOf(SettlementAmountNotPositive);
    await expect(
      repository.saveSettlement(
        plainSettlement(w, { rate: { value: 0n, source: 'manual', type: null } }),
      ),
    ).rejects.toBeInstanceOf(SettlementRateNotPositive);
    // A duplicate leg currency (unique) and a zero leg (check) are caller errors too.
    const duplicate = await repository
      .saveSettlement(
        plainSettlement(w, {
          legs: [
            { currency: 'ARS', amount: 1n },
            { currency: 'ARS', amount: 2n },
          ],
        }),
      )
      .catch((error: unknown) => error);
    expect(duplicate).toBeInstanceOf(AppError);
    expect((duplicate as AppError).code).toBe('VALIDATION_FAILED');
    const zeroLeg = await repository
      .saveSettlement(plainSettlement(w, { legs: [{ currency: 'ARS', amount: 0n }] }))
      .catch((error: unknown) => error);
    expect((zeroLeg as AppError).code).toBe('VALIDATION_FAILED');
    expect(await count('group_settlements')).toBe(0);
    expect(await count('group_settlement_legs')).toBe(0);
    expect(await count('group_activity_log')).toBe(0);
  });

  it('answers a member error when a party, the creator or the account member has left (invalid)', async () => {
    const w = await world();
    const ghost = w.memberIds[1] ?? '';
    const creator = w.memberIds[2] ?? '';
    const accountMember = w.memberIds[3] ?? '';
    const leave = (id: string) =>
      connection.pool.query('update group_members set left_at = now() where id = $1', [id]);

    await leave(ghost);
    await expect(repository.saveSettlement(plainSettlement(w))).rejects.toBeInstanceOf(
      GroupSettlementMemberInvalid,
    );
    await expect(
      repository.saveSettlement(
        plainSettlement(w, { fromMemberId: w.anaMember, toMemberId: ghost }),
      ),
    ).rejects.toBeInstanceOf(GroupSettlementMemberInvalid);
    await leave(creator);
    await expect(
      repository.saveSettlement(
        plainSettlement(w, { fromMemberId: accountMember, createdByMemberId: creator }),
      ),
    ).rejects.toBeInstanceOf(GroupSettlementMemberInvalid);
    await leave(accountMember);
    await expect(
      repository.saveSettlement(
        plainSettlement(w, {
          fromMemberId: w.anaMember,
          toMemberId: w.memberIds[1] === ghost ? accountMember : ghost,
        }),
      ),
    ).rejects.toBeInstanceOf(GroupSettlementMemberInvalid);
    expect(await count('group_settlements')).toBe(0);
  });

  it('keeps the sum of the balances at 0 across 20 concurrent settlements', async () => {
    const w = await world(5);
    await insertExpensesSql(connection.pool, w, [
      {
        payer: w.anaMember,
        amount: 600_000n,
        currency: 'ARS',
        shares: equalSplit(600_000n, w.memberIds),
      },
    ]);
    const saves = Array.from({ length: 20 }, (_, index) => {
      const from = w.memberIds[index % 6] ?? '';
      const to = w.memberIds[(index + 1 + (index % 4)) % 6] ?? '';
      return repository.saveSettlement(
        plainSettlement(w, {
          fromMemberId: from,
          toMemberId: to,
          currency: index % 2 === 0 ? 'ARS' : 'USD',
          amount: BigInt(1000 + index),
          legs: [{ currency: index % 2 === 0 ? 'ARS' : 'USD', amount: BigInt(1000 + index) }],
        }),
      );
    });

    await Promise.all(saves);

    expect(await count('group_settlements', 'group_id = $1', [w.groupId])).toBe(20);
    expect(await count('group_activity_log', "action = 'settlement_created'")).toBe(20);
    const sources = balancesByCurrency(await repository.readBalanceSources(w.groupId));
    for (const currency of ['ARS', 'USD'] as const) {
      let total = 0n;
      for (const value of sources[currency].values()) total += value;
      expect(total).toBe(0n);
    }
  });
});

describe('stale consolidated settlements under concurrency', () => {
  async function consolidatedWorld() {
    const w = await world(2);
    const a = w.anaMember;
    const b = w.memberIds[1] ?? '';
    await insertExpensesSql(connection.pool, w, [
      { payer: a, amount: 10_000n, currency: 'USD', shares: equalSplit(10_000n, [a, b]) },
      { payer: b, amount: 10_000n, currency: 'ARS', shares: equalSplit(10_000n, [a, b]) },
    ]);
    const balances = balancesByCurrency(await repository.readBalanceSources(w.groupId));
    const legs = pairLegs(balances, a, b);
    const result = consolidate(a, b, legs, 'USD', 10_000_000n);
    const data: NewGroupSettlement = plainSettlement(w, {
      fromMemberId: result.fromMemberId,
      toMemberId: result.toMemberId,
      currency: result.currency,
      amount: result.amount,
      legs: result.legs,
      rate: { value: 10_000_000n, source: 'manual', type: null },
      consolidation: { memberIds: [a, b], legs },
    });
    return { w, a, b, data };
  }

  it('saves when the balances did not move since the preview', async () => {
    const { w, data } = await consolidatedWorld();

    const saved = await repository.saveSettlement(data);

    expect(saved.legs).toHaveLength(2);
    const after = balancesByCurrency(await repository.readBalanceSources(w.groupId));
    expect([...after.ARS.values()].every((v) => v === 0n)).toBe(true);
    expect([...after.USD.values()].every((v) => v === 0n)).toBe(true);
  });

  it('answers a stale conflict when an expense commits after the preview and before the write', async () => {
    const { w, a, b, data } = await consolidatedWorld();
    const client = await connection.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from groups where id = $1 for share', [w.groupId]);
      await insertExpensesSql(client, w, [
        { payer: b, amount: 2_000n, currency: 'ARS', shares: equalSplit(2_000n, [a, b]) },
      ]);

      const save = repository.saveSettlement(data);
      const outcome = save.catch((error: unknown) => error);
      // The settlement waits for the open expense: it does not read the old balances.
      expect(await pending(outcome)).toBe(true);
      await client.query('commit');

      expect(await outcome).toBeInstanceOf(GroupSettlementStale);
    } finally {
      client.release();
    }
    expect(await count('group_settlements')).toBe(0);
    expect(await count('group_activity_log')).toBe(0);
  });

  it('makes an expense write wait for a settlement that holds the group lock', async () => {
    const { w, a, b } = await consolidatedWorld();
    const category = await groupsRepo.listCategories(w.groupId);
    const client = await connection.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from groups where id = $1 for update', [w.groupId]);
      const save = expenses.saveExpense({
        groupId: w.groupId,
        payerMemberId: a,
        createdByMemberId: a,
        amount: 1_000n,
        currency: 'ARS',
        occurredAt: new Date(NOW.getTime() - HOUR),
        categoryId: category[0]?.id ?? '',
        description: 'Cena',
        splitMode: 'equal',
        shares: equalSplit(1_000n, [a, b]).map((s) => ({ ...s, basisPoints: null })),
        activity: { action: 'expense_created', memberId: a, createdAt: NOW },
        payerMovement: null,
      });
      expect(await pending(save)).toBe(true);
      await client.query('commit');
      await save;
    } finally {
      client.release();
    }
    expect(await count('group_expenses')).toBe(3);
  });
});

describe('expense write rechecks the members', () => {
  async function expenseFor(w: DbWorld, payer: string, members: string[]) {
    const category = await groupsRepo.listCategories(w.groupId);
    return {
      groupId: w.groupId,
      payerMemberId: payer,
      createdByMemberId: w.anaMember,
      amount: 3_000n,
      currency: 'ARS' as const,
      occurredAt: new Date(NOW.getTime() - HOUR),
      categoryId: category[0]?.id ?? '',
      description: 'Cena',
      splitMode: 'equal' as const,
      shares: equalSplit(3_000n, members).map((s) => ({ ...s, basisPoints: null })),
      activity: { action: 'expense_created' as const, memberId: w.anaMember, createdAt: NOW },
      payerMovement: null,
    };
  }

  it('answers the split member error for a payer or sharer who left, like for a non-member (invalid)', async () => {
    const w = await world();
    const left = w.memberIds[1] ?? '';
    await connection.pool.query('update group_members set left_at = now() where id = $1', [left]);

    await expect(
      expenses.saveExpense(await expenseFor(w, left, [w.anaMember, w.memberIds[2] ?? ''])),
    ).rejects.toBeInstanceOf(GroupSplitMemberInvalid);
    await expect(
      expenses.saveExpense(await expenseFor(w, w.anaMember, [w.anaMember, left])),
    ).rejects.toBeInstanceOf(GroupSplitMemberInvalid);
    expect(await count('group_expenses')).toBe(0);
    expect(await count('group_activity_log')).toBe(0);
  });
});

describe('readBalanceSources', () => {
  it('derives paid, shares and legs per currency, former members included', async () => {
    const w = await world(2);
    const [a, b, c] = w.memberIds as [string, string, string];
    await insertExpensesSql(connection.pool, w, [
      { payer: a, amount: 9_000n, currency: 'ARS', shares: equalSplit(9_000n, [a, b, c]) },
      { payer: b, amount: 5_001n, currency: 'USD', shares: equalSplit(5_001n, [a, b, c]) },
    ]);
    await repository.saveSettlement(
      plainSettlement(w, {
        fromMemberId: b,
        toMemberId: a,
        amount: 1_000n,
        legs: [{ currency: 'ARS', amount: 1_000n }],
      }),
    );
    await connection.pool.query('update group_members set left_at = now() where id = $1', [c]);

    const sources = await repository.readBalanceSources(w.groupId);

    expect(sources.ARS.paid.get(a)).toBe(9_000n);
    expect(sources.ARS.shares.get(c)).toBe(3_000n);
    expect(sources.ARS.legs.get(b)).toBe(1_000n);
    expect(sources.ARS.legs.get(a)).toBe(-1_000n);
    expect(sources.USD.paid.get(b)).toBe(5_001n);
    expect(sources.USD.legs.size).toBe(0);
    const ars = computeBalances(sources.ARS);
    expect(ars.get(a)).toBe(5_000n);
    expect(ars.get(b)).toBe(-2_000n);
    expect(ars.get(c)).toBe(-3_000n);
    const usd = computeBalances(sources.USD);
    expect(usd.get(a)).toBe(-1_667n);
    expect(usd.get(b)).toBe(3_334n);
    expect(usd.get(c)).toBe(-1_667n);
  });

  it('returns no balance of another group (isolation, 404 at the use case)', async () => {
    const w = await world();
    const other = await world();
    await insertExpensesSql(connection.pool, other, [
      {
        payer: other.anaMember,
        amount: 100n,
        currency: 'ARS',
        shares: equalSplit(100n, other.memberIds.slice(0, 2)),
      },
    ]);
    await repository.saveSettlement(plainSettlement(other));

    const sources = await repository.readBalanceSources(w.groupId);

    expect(sources.ARS.paid.size + sources.ARS.shares.size + sources.ARS.legs.size).toBe(0);
    expect((await repository.listSettlements(w.groupId, { limit: 10 })).items).toEqual([]);
    expect(await repository.readBalanceSources(randomUUID())).toMatchObject({
      ARS: { paid: new Map() },
    });
  });
});

describe('listSettlements', () => {
  it('returns each settlement once across pages, newest first, with ties broken by id', async () => {
    const w = await world();
    const saved: GroupSettlement[] = [];
    for (let i = 0; i < 7; i += 1) {
      saved.push(
        await repository.saveSettlement(
          plainSettlement(w, {
            amount: BigInt(100 + i),
            legs: [{ currency: 'ARS', amount: BigInt(100 + i) }],
            // Pairs of equal instants exercise the (occurred_at, id) keyset.
            occurredAt: new Date(NOW.getTime() - Math.floor(i / 2) * HOUR),
          }),
        ),
      );
    }

    const seen: GroupSettlement[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await repository.listSettlements(w.groupId, { limit: 3, cursor });
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);

    expect(pages).toBe(3);
    expect(seen.map((s) => s.id).sort()).toEqual(saved.map((s) => s.id).sort());
    const expected = [...saved].sort(
      (a, b) =>
        b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
    expect(seen.map((s) => s.id)).toEqual(expected.map((s) => s.id));
    expect(seen.every((s) => s.legs.length === 1)).toBe(true);
  });

  it('answers a validation error for a cursor this adapter did not produce (error)', async () => {
    const w = await world();

    const failure: unknown = await repository
      .listSettlements(w.groupId, { limit: 10, cursor: 'not-a-cursor!' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('VALIDATION_FAILED');
  });

  it('lists the settlements of a claimed ghost under the same member id for the claiming user', async () => {
    const w = await world();
    const ghost = w.memberIds[1] ?? '';
    await repository.saveSettlement(plainSettlement(w, { fromMemberId: ghost }));
    await repository.saveSettlement(
      plainSettlement(w, { fromMemberId: w.anaMember, toMemberId: ghost }),
    );
    const userId = await newUserId(connection.db);
    await groupsRepo.replaceClaimLink({
      groupId: w.groupId,
      memberId: ghost,
      tokenHash: 'h'.repeat(64),
    });

    await groupsRepo.claimGhost({ tokenHash: 'h'.repeat(64), userId, now: NOW });

    const member = await groupsRepo.findMember(w.groupId, userId);
    expect(member?.id).toBe(ghost);
    const page = await repository.listSettlements(w.groupId, { limit: 10 });
    expect(page.items).toHaveLength(2);
    expect(
      page.items.filter((s) => s.fromMemberId === member?.id || s.toMemberId === member?.id),
    ).toHaveLength(2);
  });
});
