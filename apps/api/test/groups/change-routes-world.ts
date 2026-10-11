import { randomUUID } from 'node:crypto';
import {
  balancesResponseSchema,
  expenseOptionsResponseSchema,
  groupExpenseResponseSchema,
  settlementResponseSchema,
  type GroupDetailResponse,
  type GroupExpenseResponse,
  type SettlementResponse,
} from '@pesly/shared';
import { expect } from 'vitest';
import type { DatabaseConnection } from '../../src/shared/db/client';
import {
  call,
  createGroup,
  invitationTokenOf,
  readGroup,
  setupGroupApi,
  type TestUser,
} from './routes-harness';

export const OCCURRED_AT = '2026-10-10T10:00:00.000Z';

export interface ChangeWorld {
  api: ReturnType<typeof setupGroupApi>;
  ana: TestUser;
  bob: TestUser;
  carol: TestUser;
  groupId: string;
  anaMember: string;
  bobMember: string;
  carolMember: string;
  categoryId: string;
}

function memberOf(
  detail: GroupDetailResponse,
  predicate: (member: GroupDetailResponse['members'][number]) => boolean,
): string {
  const member = detail.members.find(predicate);
  if (!member) throw new Error('member not found');
  return member.id;
}

/** Ana (admin), Bob and Carol (members); only Ana and Bob take part in the records. */
export async function changeWorld(connection: DatabaseConnection): Promise<ChangeWorld> {
  const api = setupGroupApi(connection);
  const ana = await api.makeUser('ana');
  const bob = await api.makeUser('bob');
  const carol = await api.makeUser('carol');
  const group = await createGroup(api.app, ana);
  for (const user of [bob, carol]) {
    const joined = await call(api.app, 'post', '/groups/join', user.cookies, {
      token: await invitationTokenOf(api.app, ana, group.id),
    });
    expect(joined.status).toBe(200);
  }
  const detail = await readGroup(api.app, ana, group.id);
  // Members are listed in join order: Bob joined before Carol.
  const plain = detail.members.filter((member) => member.role === 'member');
  const options = expenseOptionsResponseSchema.parse(
    (await call(api.app, 'get', `/groups/${group.id}/expense-options`, ana.cookies)).body,
  );
  return {
    api,
    ana,
    bob,
    carol,
    groupId: group.id,
    anaMember: memberOf(detail, (m) => m.role === 'admin'),
    bobMember: plain[0]?.id ?? '',
    carolMember: plain[1]?.id ?? '',
    categoryId: options.categories[0]?.id ?? '',
  };
}

export function updateExpenseBody(
  w: ChangeWorld,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    amount: '6000000',
    occurredAt: OCCURRED_AT,
    categoryId: w.categoryId,
    description: 'Cena editada',
    split: { mode: 'equal', memberIds: [w.anaMember, w.bobMember] },
    ...overrides,
  };
}

/** 40,000.00 ARS paid by Ana, split equally with Bob, recorded by Bob. */
export async function recordExpense(
  w: ChangeWorld,
  overrides: Record<string, unknown> = {},
  recorder: TestUser = w.bob,
): Promise<GroupExpenseResponse> {
  const response = await call(
    w.api.app,
    'post',
    `/groups/${w.groupId}/expenses`,
    recorder.cookies,
    {
      amount: '4000000',
      currency: 'ARS',
      occurredAt: OCCURRED_AT,
      payerMemberId: w.anaMember,
      categoryId: w.categoryId,
      description: 'Cena',
      split: { mode: 'equal', memberIds: [w.anaMember, w.bobMember] },
      ...overrides,
    },
  );
  expect(response.status).toBe(201);
  return groupExpenseResponseSchema.parse(response.body);
}

/** Bob pays Ana 1,000.00 ARS, recorded by Bob. */
export async function recordSettlement(
  w: ChangeWorld,
  overrides: Record<string, unknown> = {},
): Promise<SettlementResponse> {
  const response = await call(
    w.api.app,
    'post',
    `/groups/${w.groupId}/settlements`,
    w.bob.cookies,
    {
      kind: 'single',
      fromMemberId: w.bobMember,
      toMemberId: w.anaMember,
      currency: 'ARS',
      amount: '100000',
      occurredAt: OCCURRED_AT,
      ...overrides,
    },
  );
  expect(response.status).toBe(201);
  return settlementResponseSchema.parse(response.body);
}

export async function arsBalanceOf(w: ChangeWorld, memberId: string): Promise<string | undefined> {
  const response = await call(w.api.app, 'get', `/groups/${w.groupId}/balances`, w.ana.cookies);
  expect(response.status).toBe(200);
  return balancesResponseSchema
    .parse(response.body)
    .ARS.members.find((member) => member.memberId === memberId)?.balance;
}

export const unknownId = (): string => randomUUID();
