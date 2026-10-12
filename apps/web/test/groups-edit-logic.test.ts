import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import {
  canEditRecord,
  isConsolidatedSettlement,
  selfRole,
} from '../src/features/groups/edit/permissions';
import {
  buildExpenseEditRequest,
  expenseEditValues,
  type ExpenseEditContext,
} from '../src/features/groups/edit/expense-edit-values';
import {
  buildSettlementEditRequest,
  settlementEditValues,
  type SettlementEditContext,
} from '../src/features/groups/edit/settlement-edit-request';
import { applyQueuedValues } from '../src/features/groups/edit/queued-values';
import type { QueuedGroupChange } from '../src/lib/local-store/group-queue';

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const CATEGORY = '44444444-4444-4444-8444-444444444444';
const GROUP = '99999999-9999-4999-8999-999999999999';
const TZ = 'America/Argentina/Buenos_Aires';

const expenseContext: ExpenseEditContext = {
  members: [{ id: ANA }, { id: BRUNO }, { id: CARLA }],
  groupCategories: [{ id: CATEGORY, archivedAt: null }],
  timeZone: TZ,
  locale: 'en',
  now: new Date('2026-10-11T15:00:00.000Z'),
};

function expense(overrides: Partial<GroupExpenseResponse> = {}): GroupExpenseResponse {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    groupId: GROUP,
    payerMemberId: ANA,
    createdByMemberId: BRUNO,
    amount: '10000',
    currency: 'ARS',
    occurredAt: '2026-10-11T13:00:00.000Z',
    categoryId: CATEGORY,
    description: 'Groceries',
    splitMode: 'equal',
    payerMovementId: null,
    createdAt: '2026-10-11T13:00:00.000Z',
    shares: [
      { memberId: ANA, amount: '3334' },
      { memberId: BRUNO, amount: '3333' },
      { memberId: CARLA, amount: '3333' },
    ],
    version: 1,
    ...overrides,
  };
}

function settlement(overrides: Partial<SettlementResponse> = {}): SettlementResponse {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    groupId: GROUP,
    fromMemberId: ANA,
    toMemberId: BRUNO,
    currency: 'ARS',
    amount: '5000',
    legs: [{ currency: 'ARS', amount: '5000' }],
    occurredAt: '2026-10-11T13:00:00.000Z',
    createdByMemberId: ANA,
    accountId: null,
    rate: null,
    rateSource: null,
    rateType: null,
    createdAt: '2026-10-11T13:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('permissions', () => {
  it('lets the creator and an admin edit, and nobody else', () => {
    expect(canEditRecord(BRUNO, BRUNO, 'member')).toBe(true);
    expect(canEditRecord(BRUNO, ANA, 'admin')).toBe(true);
    expect(canEditRecord(BRUNO, CARLA, 'member')).toBe(false);
    expect(canEditRecord(BRUNO, CARLA, undefined)).toBe(false);
    expect(canEditRecord(BRUNO, CARLA, null)).toBe(false);
  });

  it('reads the caller role from the members, unknown when absent', () => {
    const members = [
      { id: ANA, role: 'admin' },
      { id: BRUNO, role: 'member' },
    ] as const;
    expect(selfRole(members, ANA)).toBe('admin');
    expect(selfRole(members, BRUNO)).toBe('member');
    expect(selfRole(members, CARLA)).toBeNull();
  });

  it('calls a settlement with a rate consolidated', () => {
    expect(isConsolidatedSettlement(settlement({ rate: '12000000' }))).toBe(true);
    expect(isConsolidatedSettlement(settlement())).toBe(false);
  });
});

describe('expenseEditValues', () => {
  it('prefills amount, date, category, description and an equal split', () => {
    const values = expenseEditValues(expense(), undefined, expenseContext);
    expect(values.amount).toBe('100.00');
    expect(values.occurredAt).toBe('2026-10-11T10:00');
    expect(values.categoryId).toBe(CATEGORY);
    expect(values.description).toBe('Groceries');
    expect(values.currency).toBe('ARS');
    expect(values.payerMemberId).toBe(ANA);
    expect(values.split.mode).toBe('equal');
    expect(values.split.selectedMemberIds).toEqual([ANA, BRUNO, CARLA]);
  });

  it('prefills an exact split with the stored amounts', () => {
    const values = expenseEditValues(
      expense({
        splitMode: 'exact',
        shares: [
          { memberId: ANA, amount: '7000' },
          { memberId: BRUNO, amount: '3000' },
        ],
      }),
      undefined,
      expenseContext,
    );
    expect(values.split.mode).toBe('exact');
    expect(values.split.values).toEqual({ [ANA]: '70', [BRUNO]: '30' });
  });

  it('prefills a percentage split with percentages computed from the amounts', () => {
    const values = expenseEditValues(
      expense({
        splitMode: 'percentage',
        shares: [
          { memberId: ANA, amount: '7000' },
          { memberId: BRUNO, amount: '3000' },
        ],
      }),
      undefined,
      expenseContext,
    );
    expect(values.split.mode).toBe('percentage');
    expect(values.split.values).toEqual({ [ANA]: '70', [BRUNO]: '30' });
  });

  it('falls back to exact when the payer has no share to take the rounding leftover', () => {
    const values = expenseEditValues(
      expense({
        splitMode: 'percentage',
        shares: [
          { memberId: BRUNO, amount: '5000' },
          { memberId: CARLA, amount: '5000' },
        ],
      }),
      undefined,
      expenseContext,
    );
    expect(values.split.mode).toBe('exact');
    expect(values.split.values).toEqual({ [BRUNO]: '50', [CARLA]: '50' });
  });

  it('lets a queued request win over the loaded record', () => {
    const values = expenseEditValues(
      expense(),
      {
        amount: '25050',
        occurredAt: '2026-10-10T13:00:00.000Z',
        categoryId: CATEGORY,
        description: 'Queued',
        split: { mode: 'equal', memberIds: [ANA, BRUNO] },
      },
      expenseContext,
    );
    expect(values.amount).toBe('250.50');
    expect(values.occurredAt).toBe('2026-10-10T10:00');
    expect(values.description).toBe('Queued');
    expect(values.split.selectedMemberIds).toEqual([ANA, BRUNO]);
  });
});

describe('buildExpenseEditRequest', () => {
  it('builds a request with no currency, payer, payer account or baseVersion', () => {
    const values = expenseEditValues(expense(), undefined, expenseContext);
    const result = buildExpenseEditRequest({ ...values, amount: '120.50' }, expenseContext);
    expect(result.fields).toBeUndefined();
    expect(result.request).toEqual({
      amount: '12050',
      occurredAt: '2026-10-11T13:00:00.000Z',
      categoryId: CATEGORY,
      description: 'Groceries',
      split: { mode: 'equal', memberIds: [ANA, BRUNO, CARLA] },
    });
    const keys = Object.keys(result.request ?? {});
    expect(keys).not.toContain('currency');
    expect(keys).not.toContain('payerMemberId');
    expect(keys).not.toContain('payerAccount');
    expect(keys).not.toContain('baseVersion');
  });

  it.each(['', '0', '-5', 'abc'])(
    'rejects the amount %j with a field error and no request',
    (amount) => {
      const values = expenseEditValues(expense(), undefined, expenseContext);
      const result = buildExpenseEditRequest({ ...values, amount }, expenseContext);
      expect(result.request).toBeUndefined();
      expect(result.fields?.amount).toBeDefined();
    },
  );

  it('rejects an exact split that does not add up', () => {
    const values = expenseEditValues(
      expense({
        splitMode: 'exact',
        shares: [
          { memberId: ANA, amount: '7000' },
          { memberId: BRUNO, amount: '3000' },
        ],
      }),
      undefined,
      expenseContext,
    );
    const result = buildExpenseEditRequest({ ...values, amount: '200' }, expenseContext);
    expect(result.request).toBeUndefined();
    expect(result.fields?.split).toBeDefined();
  });

  it('does not fail on the payer when the payer has left the group', () => {
    const values = expenseEditValues(
      expense({ payerMemberId: '77777777-7777-4777-8777-777777777777' }),
      undefined,
      expenseContext,
    );
    const result = buildExpenseEditRequest(values, expenseContext);
    expect(result.fields?.payer).toBeUndefined();
    expect(result.request).toBeDefined();
  });
});

const settlementContext: SettlementEditContext = {
  timeZone: TZ,
  locale: 'en',
  now: new Date('2026-10-11T15:00:00.000Z'),
};

describe('settlement edit', () => {
  it('prefills the amount and the local date, from the queue first', () => {
    expect(settlementEditValues(settlement(), undefined, settlementContext)).toEqual({
      amount: '50.00',
      occurredAt: '2026-10-11T10:00',
    });
    expect(settlementEditValues(settlement(), { amount: '7000' }, settlementContext)).toEqual({
      amount: '70.00',
      occurredAt: '2026-10-11T10:00',
    });
  });

  it.each(['', '0'])('rejects the amount %j with no request', (amount) => {
    const result = buildSettlementEditRequest(
      { amount, occurredAt: '2026-10-11T10:00' },
      settlement(),
      settlementContext,
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.amount).toBeDefined();
  });

  it('carries only the changed fields', () => {
    const amountOnly = buildSettlementEditRequest(
      { amount: '60.00', occurredAt: '2026-10-11T10:00' },
      settlement(),
      settlementContext,
    );
    expect(amountOnly.request).toEqual({ amount: '6000' });
    const both = buildSettlementEditRequest(
      { amount: '60.00', occurredAt: '2026-10-10T09:30' },
      settlement(),
      settlementContext,
    );
    expect(both.request).toEqual({ amount: '6000', occurredAt: '2026-10-10T12:30:00.000Z' });
  });

  it('is a field error when nothing changed', () => {
    const result = buildSettlementEditRequest(
      { amount: '50.00', occurredAt: '2026-10-11T10:00' },
      settlement(),
      settlementContext,
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.amount).toBeDefined();
  });

  it('rejects a future date', () => {
    const result = buildSettlementEditRequest(
      { amount: '60.00', occurredAt: '2026-12-01T10:00' },
      settlement(),
      settlementContext,
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.occurredAt).toBeDefined();
  });
});

describe('applyQueuedValues', () => {
  function change(partial: Record<string, unknown>): QueuedGroupChange {
    return {
      key: 'x',
      id: 'x',
      groupId: GROUP,
      createdAt: '2026-10-11T13:00:00.000Z',
      revision: 1,
      ...partial,
    } as QueuedGroupChange;
  }

  it('shows the queued amount, date and shares and leaves the record intact', () => {
    const record = expense();
    const snapshot = structuredClone(record);
    const shown = applyQueuedValues(
      record,
      change({
        kind: 'expense',
        operation: 'update',
        base: record,
        request: {
          amount: '20000',
          occurredAt: '2026-10-10T13:00:00.000Z',
          categoryId: CATEGORY,
          description: 'New',
          split: { mode: 'exact', shares: [{ memberId: ANA, amount: '20000' }] },
        },
      }),
    );
    expect(shown.amount).toBe('20000');
    expect(shown.occurredAt).toBe('2026-10-10T13:00:00.000Z');
    expect(shown.description).toBe('New');
    expect(shown.splitMode).toBe('exact');
    expect(shown.shares).toEqual([{ memberId: ANA, amount: '20000' }]);
    expect(record).toEqual(snapshot);
  });

  it('applies a settlement change and ignores a delete or a missing change', () => {
    const record = settlement();
    const shown = applyQueuedValues(
      record,
      change({
        kind: 'settlement',
        operation: 'update',
        base: record,
        request: { amount: '9000' },
      }),
    );
    expect(shown.amount).toBe('9000');
    expect(shown.occurredAt).toBe(record.occurredAt);
    expect(
      applyQueuedValues(record, change({ kind: 'settlement', operation: 'delete', base: record })),
    ).toEqual(record);
    expect(applyQueuedValues(record, undefined)).toEqual(record);
  });
});
