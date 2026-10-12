import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balancesByCurrency, balancesOf, DrizzleGroupSettlementRepository } from '../../src/groups';
import { groupTotalsOf, netOf } from '../../src/dashboard/domain/group-totals';
import {
  DrizzleGroupBalanceReader,
  foldSourceRows,
} from '../../src/dashboard/infrastructure/db/drizzle-group-balance-reader';
import { DrizzleGroupFlowReader } from '../../src/reports/infrastructure/db/drizzle-group-flow-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  expenseOf,
  groupOf,
  memberOf,
  settlementOf,
  windowFor,
} from '../reports/net-worth-fixtures';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId, readScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let reader: DrizzleGroupBalanceReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleGroupBalanceReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

async function totalsOf(userId: string) {
  return groupTotalsOf(await reader.sourcesOf(await readScope(userId)));
}

describe('DrizzleGroupBalanceReader', () => {
  it('(AC-36) reads owed and owing per currency from several groups in one call', async () => {
    const me = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const a = await groupOf(connection.pool);
    const aMine = await memberOf(connection.pool, a, me);
    const aTheirs = await memberOf(connection.pool, a, other);
    await expenseOf(connection.pool, {
      groupId: a,
      payerMemberId: aMine,
      amount: 3000000n,
      occurredAt: '2026-09-10T15:00:00Z',
      shares: [{ memberId: aTheirs, amount: 3000000n }],
    });
    const b = await groupOf(connection.pool);
    const bMine = await memberOf(connection.pool, b, me);
    const bTheirs = await memberOf(connection.pool, b, other);
    await expenseOf(connection.pool, {
      groupId: b,
      payerMemberId: bTheirs,
      amount: 5000n,
      currency: 'USD',
      occurredAt: '2026-09-11T15:00:00Z',
      shares: [{ memberId: bMine, amount: 5000n }],
    });

    expect(await totalsOf(me)).toEqual({
      owedToYou: { ARS: 3000000n, USD: 0n },
      youOwe: { ARS: 0n, USD: 5000n },
    });
  });

  it('(FR-11) settlement legs sent and received change the balance', async () => {
    const me = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const g = await groupOf(connection.pool);
    const mine = await memberOf(connection.pool, g, me);
    const theirs = await memberOf(connection.pool, g, other);
    // I owe 100.00: they paid it for me. I send 40.00, then they send me 10.00 back.
    await expenseOf(connection.pool, {
      groupId: g,
      payerMemberId: theirs,
      amount: 10000n,
      occurredAt: '2026-09-10T15:00:00Z',
      shares: [{ memberId: mine, amount: 10000n }],
    });
    await settlementOf(connection.pool, {
      groupId: g,
      fromMemberId: mine,
      toMemberId: theirs,
      amount: 4000n,
      occurredAt: '2026-09-12T15:00:00Z',
    });
    await settlementOf(connection.pool, {
      groupId: g,
      fromMemberId: theirs,
      toMemberId: mine,
      amount: 1000n,
      occurredAt: '2026-09-13T15:00:00Z',
    });

    expect(await totalsOf(me)).toEqual({
      owedToYou: { ARS: 0n, USD: 0n },
      youOwe: { ARS: 7000n, USD: 0n },
    });
  });

  it('(AC-38) counts a left group with a balance and drops one that is settled', async () => {
    const me = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const left = await groupOf(connection.pool);
    const mineLeft = await memberOf(connection.pool, left, me, true);
    const theirsLeft = await memberOf(connection.pool, left, other);
    await expenseOf(connection.pool, {
      groupId: left,
      payerMemberId: theirsLeft,
      amount: 2000n,
      occurredAt: '2026-09-10T15:00:00Z',
      shares: [{ memberId: mineLeft, amount: 2000n }],
    });
    const settled = await groupOf(connection.pool);
    const mineSettled = await memberOf(connection.pool, settled, me, true);
    const theirsSettled = await memberOf(connection.pool, settled, other);
    await expenseOf(connection.pool, {
      groupId: settled,
      payerMemberId: theirsSettled,
      amount: 900n,
      occurredAt: '2026-09-10T15:00:00Z',
      shares: [{ memberId: mineSettled, amount: 900n }],
    });
    await settlementOf(connection.pool, {
      groupId: settled,
      fromMemberId: mineSettled,
      toMemberId: theirsSettled,
      amount: 900n,
      occurredAt: '2026-09-11T15:00:00Z',
    });

    expect(await totalsOf(me)).toEqual({
      owedToYou: { ARS: 0n, USD: 0n },
      youOwe: { ARS: 2000n, USD: 0n },
    });
  });

  it('(AC-45) never reads groups the caller never joined or the balances of other users', async () => {
    const me = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const third = await newUserId(connection.db);
    const g = await groupOf(connection.pool);
    const theirs = await memberOf(connection.pool, g, other);
    const thirds = await memberOf(connection.pool, g, third);
    await expenseOf(connection.pool, {
      groupId: g,
      payerMemberId: theirs,
      amount: 8000n,
      occurredAt: '2026-09-10T15:00:00Z',
      shares: [{ memberId: thirds, amount: 8000n }],
    });

    expect(await reader.sourcesOf(await readScope(me))).toEqual([]);
    expect(await totalsOf(other)).toEqual({
      owedToYou: { ARS: 8000n, USD: 0n },
      youOwe: { ARS: 0n, USD: 0n },
    });
  });

  it('(FR-15) equals the groups module balance per group and the 09a group reader net at today', async () => {
    const me = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const g = await groupOf(connection.pool);
    const mine = await memberOf(connection.pool, g, me);
    const theirs = await memberOf(connection.pool, g, other);
    await expenseOf(connection.pool, {
      groupId: g,
      payerMemberId: mine,
      amount: 12000n,
      occurredAt: '2026-09-10T15:00:00Z',
      shares: [
        { memberId: mine, amount: 3000n },
        { memberId: theirs, amount: 9000n },
      ],
    });
    await settlementOf(connection.pool, {
      groupId: g,
      fromMemberId: theirs,
      toMemberId: mine,
      amount: 2500n,
      occurredAt: '2026-09-12T15:00:00Z',
    });

    const scope = await readScope(me);
    const entries = await reader.sourcesOf(scope);
    const expected = balancesOf(
      balancesByCurrency(
        await new DrizzleGroupSettlementRepository(connection.db).readBalanceSources(g),
      ),
      mine,
    );
    const flows = await new DrizzleGroupFlowReader(connection.db).groupFlows(
      scope,
      windowFor('2026-10', '2026-10', '2026-10-06'),
    );

    expect(entries).toHaveLength(1);
    expect(groupTotalsOf(entries).owedToYou.ARS).toBe(expected.ARS);
    expect(netOf(groupTotalsOf(entries))).toEqual(flows.baseline);
  });

  it('(FR-16) a database error rejects the read', async () => {
    const closed = createDatabase(testDatabaseUrl);
    await closed.pool.end();
    const failing = new DrizzleGroupBalanceReader(closed.db);
    const scope = await readScope(await newUserId(connection.db));

    await expect(failing.sourcesOf(scope)).rejects.toThrow();
  });

  it('(FR-16) an unknown currency row is an invalid source', () => {
    expect(() =>
      foldSourceRows([
        { group_id: 'g', member_id: 'm', source: 'paid', currency: 'EUR', total: '10' },
      ]),
    ).toThrow(/currency/i);
  });
});
