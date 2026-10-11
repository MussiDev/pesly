import { randomUUID } from 'node:crypto';
import {
  balancesResponseSchema,
  consolidationPreviewSchema,
  expenseOptionsResponseSchema,
  groupDetailResponseSchema,
  listAccountsResponseSchema,
  listMovementsResponseSchema,
  settlementPageSchema,
  settlementResponseSchema,
  type GroupDetailResponse,
  type SettlementResponse,
} from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount } from '../movements/db-fixtures';
import {
  call,
  createGroup,
  invitationTokenOf,
  readGroup,
  setupGroupApi,
  type Method,
  type TestUser,
} from './routes-harness';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  // mep at 1,000.0000 ARS per USD; blue at 1,500.0000 to change the default type.
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 9900000, 10000000, now(), now()), ('blue', 14900000, 15000000, now(), now())`,
  );
});

const OCCURRED_AT = '2026-10-10T10:00:00.000Z';
const MAX_AMOUNT = '1000000000000000';
const MAX_PLUS_ONE = '1000000000000001';

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

/** Ana (admin), Bob (member) and the ghost Pedro. */
async function world(): Promise<World> {
  const api = setupGroupApi(connection, { withAccountRoutes: true });
  const ana = await api.makeUser('ana');
  const bob = await api.makeUser('bob');
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

/** An expense paid by `payer`, split equally among `among`, recorded by another member. */
async function expense(
  w: World,
  payer: string,
  amount: string,
  currency: 'ARS' | 'USD',
  among: string[],
): Promise<void> {
  // The payer never records it: a payer who records must name an account (spec 05b).
  const user = payer === w.anaMember ? w.bob : w.ana;
  const response = await call(w.api.app, 'post', `/groups/${w.groupId}/expenses`, user.cookies, {
    amount,
    currency,
    occurredAt: OCCURRED_AT,
    payerMemberId: payer,
    categoryId: w.categoryId,
    description: 'Gasto',
    split: { mode: 'equal', memberIds: among },
  });
  expect(response.status).toBe(201);
}

function singleBody(
  from: string,
  to: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 'single',
    fromMemberId: from,
    toMemberId: to,
    currency: 'ARS',
    amount: '100000',
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

async function settle(
  w: World,
  user: TestUser,
  body: Record<string, unknown>,
): Promise<SettlementResponse> {
  const response = await call(
    w.api.app,
    'post',
    `/groups/${w.groupId}/settlements`,
    user.cookies,
    body,
  );
  expect(response.status).toBe(201);
  return settlementResponseSchema.parse(response.body);
}

async function balances(w: World, user: TestUser = w.ana) {
  const response = await call(w.api.app, 'get', `/groups/${w.groupId}/balances`, user.cookies);
  expect(response.status).toBe(200);
  return balancesResponseSchema.parse(response.body);
}

function balanceOf(
  result: ReturnType<typeof balancesResponseSchema.parse>,
  currency: 'ARS' | 'USD',
  memberId: string,
): string | undefined {
  return result[currency].members.find((m) => m.memberId === memberId)?.balance;
}

/** Ana owes Bob 100.00 USD and Bob owes Ana 50,000.00 ARS. */
async function crossedDebts(w: World): Promise<void> {
  await expense(w, w.bobMember, '20000', 'USD', [w.anaMember, w.bobMember]);
  await expense(w, w.anaMember, '10000000', 'ARS', [w.anaMember, w.bobMember]);
}

async function preview(w: World, user: TestUser = w.ana) {
  const response = await call(
    w.api.app,
    'get',
    `/groups/${w.groupId}/settlements/consolidation?memberA=${w.anaMember}&memberB=${w.bobMember}&currency=USD`,
    user.cookies,
  );
  expect(response.status).toBe(200);
  return consolidationPreviewSchema.parse(response.body);
}

function consolidatedBody(
  w: World,
  legs: { ARS: string; USD: string },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 'consolidated',
    memberIds: [w.anaMember, w.bobMember],
    currency: 'USD',
    occurredAt: OCCURRED_AT,
    legs,
    ...overrides,
  };
}

describe('GET /groups/:id/balances', () => {
  it('shows each member in ARS and USD and the payments per currency (AC-01, AC-03)', async () => {
    const w = await world();
    await expense(w, w.anaMember, '300000', 'ARS', [w.anaMember, w.bobMember, w.pedro]);
    await expense(w, w.bobMember, '10000', 'USD', [w.anaMember, w.bobMember]);

    const result = await balances(w, w.bob);

    expect(balanceOf(result, 'ARS', w.anaMember)).toBe('200000');
    expect(balanceOf(result, 'ARS', w.bobMember)).toBe('-100000');
    expect(balanceOf(result, 'ARS', w.pedro)).toBe('-100000');
    expect(result.ARS.payments).toHaveLength(2);
    for (const payment of result.ARS.payments) {
      expect(payment).toMatchObject({ toMemberId: w.anaMember, amount: '100000' });
    }
    expect(balanceOf(result, 'USD', w.anaMember)).toBe('-5000');
    expect(balanceOf(result, 'USD', w.bobMember)).toBe('5000');
    expect(balanceOf(result, 'USD', w.pedro)).toBe('0');
    expect(result.USD.payments).toEqual([
      { fromMemberId: w.anaMember, toMemberId: w.bobMember, amount: '5000' },
    ]);
  });

  it('answers no payments when every balance is 0 (AC-04)', async () => {
    const w = await world();
    const result = await balances(w);
    expect(result.ARS.payments).toEqual([]);
    expect(result.USD.payments).toEqual([]);
    expect(result.ARS.members).toHaveLength(3);
  });
});

describe('POST /groups/:id/settlements (single)', () => {
  it('answers 201 and moves the balances by the amount (AC-05)', async () => {
    const w = await world();
    await expense(w, w.anaMember, '400000', 'ARS', [w.anaMember, w.bobMember]);

    const settlement = await settle(w, w.bob, singleBody(w.bobMember, w.anaMember));

    expect(settlement).toMatchObject({
      groupId: w.groupId,
      fromMemberId: w.bobMember,
      toMemberId: w.anaMember,
      currency: 'ARS',
      amount: '100000',
      createdByMemberId: w.bobMember,
      accountId: null,
      rate: null,
      rateSource: null,
      rateType: null,
      legs: [{ currency: 'ARS', amount: '100000' }],
    });
    const result = await balances(w);
    expect(balanceOf(result, 'ARS', w.anaMember)).toBe('100000');
    expect(balanceOf(result, 'ARS', w.bobMember)).toBe('-100000');
    expect(result.ARS.payments).toEqual([
      { fromMemberId: w.bobMember, toMemberId: w.anaMember, amount: '100000' },
    ]);
  });

  it.each([
    ['an amount of 0', { amount: '0' }],
    ['a negative amount', { amount: '-5' }],
    ['an unknown extra key', { extra: 1 }],
    ['a missing kind', { kind: undefined }],
    ['a malformed member id', { fromMemberId: 'nope' }],
  ])('answers 400 VALIDATION_FAILED for %s and stores nothing (AC-06)', async (_label, change) => {
    const w = await world();
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      singleBody(w.anaMember, w.bobMember, change),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    const rows = await connection.pool.query('select 1 from group_settlements');
    expect(rows.rowCount).toBe(0);
  });

  it('answers 400 for the same member on both sides (AC-06)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      singleBody(w.anaMember, w.anaMember),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('answers 400 GROUP_SETTLEMENT_MEMBER_INVALID for a party who is not a member (AC-07)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      singleBody(w.anaMember, randomUUID()),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('GROUP_SETTLEMENT_MEMBER_INVALID');
  });

  it('accepts the maximum amount and answers 400 for one unit more (NFR-01)', async () => {
    const w = await world();
    const ok = await settle(w, w.ana, singleBody(w.anaMember, w.bobMember, { amount: MAX_AMOUNT }));
    expect(ok.amount).toBe(MAX_AMOUNT);
    const over = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      singleBody(w.anaMember, w.bobMember, { amount: MAX_PLUS_ONE }),
    );
    expect(over.status).toBe(400);
    expect((over.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /groups/:id/settlements with an account', () => {
  async function accountBalances(w: World): Promise<Record<string, string>> {
    const response = await call(w.api.app, 'get', '/accounts', w.ana.cookies);
    expect(response.status).toBe(200);
    const list = listAccountsResponseSchema.parse(response.body);
    return Object.fromEntries(list.items.map((account) => [account.id, account.balance]));
  }

  async function movementTotal(w: World): Promise<number> {
    const response = await call(w.api.app, 'get', '/movements', w.ana.cookies);
    expect(response.status).toBe(200);
    return listMovementsResponseSchema.parse(response.body).total;
  }

  it('raises the account that received and lowers the one that paid, with no movement row (AC-08, AC-09)', async () => {
    const w = await world();
    const accountId = await newAccount(connection.pool, w.ana.id, false, 'ARS');
    const before = await accountBalances(w);
    const totalBefore = await movementTotal(w);

    await settle(w, w.ana, singleBody(w.bobMember, w.anaMember, { accountId }));
    expect((await accountBalances(w))[accountId]).toBe(
      (BigInt(before[accountId] ?? '0') + 100000n).toString(),
    );

    await settle(w, w.ana, singleBody(w.anaMember, w.pedro, { accountId, amount: '30000' }));
    expect((await accountBalances(w))[accountId]).toBe(
      (BigInt(before[accountId] ?? '0') + 70000n).toString(),
    );

    expect(await movementTotal(w)).toBe(totalBefore);
    const movements = await connection.pool.query('select 1 from movements');
    expect(movements.rowCount).toBe(0);
  });

  it('answers 400 GROUP_SETTLEMENT_ACCOUNT_INVALID for a USD account on an ARS settlement (AC-10)', async () => {
    const w = await world();
    const accountId = await newAccount(connection.pool, w.ana.id, false, 'USD');
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      singleBody(w.anaMember, w.bobMember, { accountId }),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('GROUP_SETTLEMENT_ACCOUNT_INVALID');
  });

  it('answers 400 for an account of someone else and for a caller who is not a party (AC-10)', async () => {
    const w = await world();
    const bobAccount = await newAccount(connection.pool, w.bob.id, false, 'ARS');
    const anaAccount = await newAccount(connection.pool, w.ana.id, false, 'ARS');
    const foreign = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      singleBody(w.anaMember, w.bobMember, { accountId: bobAccount }),
    );
    expect(foreign.status).toBe(400);
    expect((foreign.body as { code: string }).code).toBe('GROUP_SETTLEMENT_ACCOUNT_INVALID');
    const notParty = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      singleBody(w.bobMember, w.pedro, { accountId: anaAccount }),
    );
    expect(notParty.status).toBe(400);
    expect((notParty.body as { code: string }).code).toBe('GROUP_SETTLEMENT_ACCOUNT_INVALID');
  });
});

describe('consolidated settlements', () => {
  it('records 50.00 USD at 1,000.0000 and both balances reach 0 (AC-11)', async () => {
    const w = await world();
    await crossedDebts(w);
    const shown = await preview(w);
    expect(shown.legs).toEqual({ ARS: '-5000000', USD: '10000' });

    const settlement = await settle(w, w.ana, consolidatedBody(w, shown.legs));

    expect(settlement).toMatchObject({
      fromMemberId: w.anaMember,
      toMemberId: w.bobMember,
      currency: 'USD',
      amount: '5000',
      rate: '10000000',
      rateSource: 'automatic',
      rateType: 'mep',
    });
    expect(settlement.legs).toHaveLength(2);
    const result = await balances(w);
    for (const currency of ['ARS', 'USD'] as const) {
      expect(balanceOf(result, currency, w.anaMember)).toBe('0');
      expect(balanceOf(result, currency, w.bobMember)).toBe('0');
      expect(result[currency].payments).toEqual([]);
    }
  });

  it('stores a manual rate with source manual and no type (AC-12)', async () => {
    const w = await world();
    await crossedDebts(w);
    const shown = await preview(w);

    const settlement = await settle(
      w,
      w.ana,
      consolidatedBody(w, shown.legs, { rate: '20000000' }),
    );

    expect(settlement).toMatchObject({
      amount: '7500',
      rate: '20000000',
      rateSource: 'manual',
      rateType: null,
    });
  });

  it.each([['0'], ['-5']])(
    'answers 400 VALIDATION_FAILED for a rate of %s (AC-13)',
    async (rate) => {
      const w = await world();
      await crossedDebts(w);
      const shown = await preview(w);
      const response = await call(
        w.api.app,
        'post',
        `/groups/${w.groupId}/settlements`,
        w.ana.cookies,
        consolidatedBody(w, shown.legs, { rate }),
      );
      expect(response.status).toBe(400);
      expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    },
  );

  it('answers 409 GROUP_SETTLEMENT_STALE when the balances moved after the preview (D6)', async () => {
    const w = await world();
    await crossedDebts(w);
    const shown = await preview(w);
    await expense(w, w.anaMember, '1000', 'ARS', [w.anaMember, w.bobMember]);

    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      consolidatedBody(w, shown.legs),
    );

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('GROUP_SETTLEMENT_STALE');
    const rows = await connection.pool.query('select 1 from group_settlements');
    expect(rows.rowCount).toBe(0);
  });

  it('answers 400 GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE when one currency has no debt (D6)', async () => {
    const w = await world();
    await expense(w, w.bobMember, '20000', 'USD', [w.anaMember, w.bobMember]);
    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      consolidatedBody(w, { ARS: '-5000000', USD: '10000' }),
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe(
      'GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE',
    );
  });

  it('answers 400 VALIDATION_FAILED when the converted cash exceeds the maximum and stores nothing (overflow)', async () => {
    const w = await world();
    // Ana owes Bob 5e14 USD while Bob owes Ana 500.00 ARS.
    await expense(w, w.bobMember, '1000000000000000', 'USD', [w.anaMember, w.bobMember]);
    await expense(w, w.anaMember, '100000', 'ARS', [w.anaMember, w.bobMember]);
    const shown = await preview(w);

    const response = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/settlements`,
      w.ana.cookies,
      consolidatedBody(w, shown.legs, { currency: 'ARS', rate: '999999999999' }),
    );

    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
    const rows = await connection.pool.query('select 1 from group_settlements');
    expect(rows.rowCount).toBe(0);
  });

  it('answers 400 for a consolidation preview with the same member twice (invalid query)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'get',
      `/groups/${w.groupId}/settlements/consolidation?memberA=${w.anaMember}&memberB=${w.anaMember}&currency=USD`,
      w.ana.cookies,
    );
    expect(response.status).toBe(400);
  });

  it('prefills the rate of the current default rate type; stored settlements keep theirs (AC-14)', async () => {
    const w = await world();
    await crossedDebts(w);
    const first = await preview(w);
    expect(first).toMatchObject({ defaultRateType: 'mep', rate: '10000000' });
    const settlement = await settle(w, w.ana, consolidatedBody(w, first.legs));
    expect(settlement.rate).toBe('10000000');

    const changed = await call(w.api.app, 'patch', `/groups/${w.groupId}`, w.ana.cookies, {
      defaultRateType: 'blue',
    });
    expect(changed.status).toBe(200);
    await crossedDebts(w);

    const second = await preview(w);
    expect(second).toMatchObject({ defaultRateType: 'blue', rate: '15000000' });
    const page = settlementPageSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}/settlements`, w.ana.cookies)).body,
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ rate: '10000000', rateType: 'mep' });
  });
});

describe('GET /groups/:id/settlements', () => {
  it('lists newest first and pages with an opaque cursor, each settlement once (AC-05)', async () => {
    const w = await world();
    const ids: string[] = [];
    for (const [index, amount] of ['100', '200', '300'].entries()) {
      const created = await settle(
        w,
        w.ana,
        singleBody(w.anaMember, w.bobMember, {
          amount,
          occurredAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        }),
      );
      ids.unshift(created.id);
    }

    const first = settlementPageSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}/settlements?limit=2`, w.bob.cookies))
        .body,
    );
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    const second = settlementPageSchema.parse(
      (
        await call(
          w.api.app,
          'get',
          `/groups/${w.groupId}/settlements?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
          w.bob.cookies,
        )
      ).body,
    );
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it('answers 400 for a limit above the maximum or an unknown query key (invalid query)', async () => {
    const w = await world();
    for (const query of ['limit=101', 'limit=0', 'other=1']) {
      const response = await call(
        w.api.app,
        'get',
        `/groups/${w.groupId}/settlements?${query}`,
        w.ana.cookies,
      );
      expect(response.status).toBe(400);
    }
  });

  it("shows a claimed ghost's settlements to the claimer under the same member id (AC-21)", async () => {
    const w = await world();
    const carol = await w.api.makeUser('carol');
    await settle(w, w.ana, singleBody(w.bobMember, w.pedro, { amount: '500' }));
    await settle(w, w.ana, singleBody(w.pedro, w.anaMember, { amount: '700' }));
    const link = await call(
      w.api.app,
      'post',
      `/groups/${w.groupId}/members/${w.pedro}/claim-links`,
      w.ana.cookies,
    );
    expect(link.status).toBe(201);
    const claimed = await call(w.api.app, 'post', '/groups/claim', carol.cookies, {
      token: (link.body as { token: string }).token,
    });
    expect(claimed.status).toBe(200);

    const detail = groupDetailResponseSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}`, carol.cookies)).body,
    );
    const carolMember = memberIdOf(detail, (m) => !m.isGhost && m.id === w.pedro);
    const page = settlementPageSchema.parse(
      (await call(w.api.app, 'get', `/groups/${w.groupId}/settlements`, carol.cookies)).body,
    );
    const mine = page.items.filter(
      (item) => item.fromMemberId === carolMember || item.toMemberId === carolMember,
    );
    expect(mine).toHaveLength(2);
  });
});

describe('DELETE /groups/:id/members/:memberId', () => {
  it('lets an admin remove a member at balance 0 with 204; the member then gets 404 (AC-15)', async () => {
    const w = await world();

    const response = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/members/${w.bobMember}`,
      w.ana.cookies,
    );

    expect(response.status).toBe(204);
    const gone = await call(w.api.app, 'get', `/groups/${w.groupId}`, w.bob.cookies);
    expect(gone.status).toBe(404);
    const detail = await readGroup(w.api.app, w.ana, w.groupId);
    expect(detail.members.map((m) => m.id)).not.toContain(w.bobMember);
    expect(detail.formerMembers.map((m) => m.id)).toEqual([w.bobMember]);
  });

  it('answers 409 GROUP_MEMBER_HAS_BALANCE with the signed balance per currency (AC-16)', async () => {
    const w = await world();
    await expense(w, w.anaMember, '300000', 'ARS', [w.anaMember, w.bobMember]);

    const response = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/members/${w.bobMember}`,
      w.ana.cookies,
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      code: 'GROUP_MEMBER_HAS_BALANCE',
      details: { ARS: '-150000', USD: '0' },
    });
    const detail = await readGroup(w.api.app, w.ana, w.groupId);
    expect(detail.members.map((m) => m.id)).toContain(w.bobMember);
  });

  it('answers 403 GROUP_ADMIN_REQUIRED to a member who is not an admin (AC-17)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/members/${w.pedro}`,
      w.bob.cookies,
    );
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('GROUP_ADMIN_REQUIRED');
  });

  it('answers 404 for a member who is not in the group and 400 for a malformed id (invalid)', async () => {
    const w = await world();
    const missing = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/members/${randomUUID()}`,
      w.ana.cookies,
    );
    expect(missing.status).toBe(404);
    const malformed = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/members/nope`,
      w.ana.cookies,
    );
    expect(malformed.status).toBe(400);
  });

  it('answers 400 when an admin removes themselves; leaving is the other action (invalid)', async () => {
    const w = await world();
    const response = await call(
      w.api.app,
      'delete',
      `/groups/${w.groupId}/members/${w.anaMember}`,
      w.ana.cookies,
    );
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /groups/:id/leave', () => {
  it('lets a member at balance 0 leave with 204 and then answers 404 (AC-18)', async () => {
    const w = await world();

    const response = await call(w.api.app, 'post', `/groups/${w.groupId}/leave`, w.bob.cookies);

    expect(response.status).toBe(204);
    const gone = await call(w.api.app, 'get', `/groups/${w.groupId}`, w.bob.cookies);
    expect(gone.status).toBe(404);
  });

  it('answers 409 GROUP_MEMBER_HAS_BALANCE with the balance when it is not 0 (AC-19)', async () => {
    const w = await world();
    await expense(w, w.bobMember, '10000', 'USD', [w.anaMember, w.bobMember]);

    const response = await call(w.api.app, 'post', `/groups/${w.groupId}/leave`, w.bob.cookies);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      code: 'GROUP_MEMBER_HAS_BALANCE',
      details: { ARS: '0', USD: '5000' },
    });
  });

  it('answers 409 GROUP_LAST_ADMIN when the last admin leaves while others remain', async () => {
    const w = await world();
    const response = await call(w.api.app, 'post', `/groups/${w.groupId}/leave`, w.ana.cookies);
    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('GROUP_LAST_ADMIN');
  });
});

describe('access (AC-23)', () => {
  function everyRoute(
    w: World,
  ): { method: Method; path: string; body?: Record<string, unknown> }[] {
    const base = `/groups/${w.groupId}`;
    return [
      { method: 'get', path: `${base}/balances` },
      { method: 'post', path: `${base}/settlements`, body: singleBody(w.anaMember, w.bobMember) },
      { method: 'get', path: `${base}/settlements` },
      {
        method: 'get',
        path: `${base}/settlements/consolidation?memberA=${w.anaMember}&memberB=${w.bobMember}&currency=USD`,
      },
      { method: 'delete', path: `${base}/members/${w.pedro}` },
      { method: 'post', path: `${base}/leave` },
    ];
  }

  it('answers 404 on every route to a non-member', async () => {
    const w = await world();
    const outsider = await w.api.makeUser('eve');
    for (const route of everyRoute(w)) {
      const response = await call(
        w.api.app,
        route.method,
        route.path,
        outsider.cookies,
        route.body,
      );
      expect([route.path, response.status]).toEqual([route.path, 404]);
    }
  });

  it('answers 404 on every route to a user who left', async () => {
    const w = await world();
    const left = await call(w.api.app, 'post', `/groups/${w.groupId}/leave`, w.bob.cookies);
    expect(left.status).toBe(204);
    for (const route of everyRoute(w)) {
      const response = await call(w.api.app, route.method, route.path, w.bob.cookies, route.body);
      expect([route.path, response.status]).toEqual([route.path, 404]);
    }
  });
});
