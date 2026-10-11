import { createGroupExpenseRequestSchema } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import {
  buildExpenseRequest,
  formatBasisPoints,
  initialSplitState,
  type ExpenseFormValues,
  type ExpenseRequestContext,
} from '../src/features/groups/expenses/form/expense-request';
import { createSplitState } from '../src/features/groups/split/split-state';

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const GROUP_CATEGORY = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ARS = '55555555-5555-4555-8555-555555555555';
const ACCOUNT_USD = '66666666-6666-4666-8666-666666666666';
const PERSONAL_CATEGORY = '77777777-7777-4777-8777-777777777777';

const context: ExpenseRequestContext = {
  members: [{ id: ANA }, { id: BRUNO }, { id: CARLA }],
  groupCategories: [{ id: GROUP_CATEGORY, archivedAt: null }],
  accounts: [
    { id: ACCOUNT_ARS, currency: 'ARS', archived: false },
    { id: ACCOUNT_USD, currency: 'USD', archived: true },
  ],
  personalCategoryIds: [PERSONAL_CATEGORY],
  currentMemberId: ANA,
  timeZone: 'America/Argentina/Buenos_Aires',
  locale: 'en',
  now: new Date('2026-10-11T15:00:00.000Z'),
};

function values(overrides: Partial<ExpenseFormValues> = {}): ExpenseFormValues {
  return {
    amount: '100.00',
    currency: 'ARS',
    occurredAt: '2026-10-11T10:00',
    payerMemberId: BRUNO,
    categoryId: GROUP_CATEGORY,
    description: 'Groceries',
    payerAccountId: '',
    payerCategoryId: '',
    split: createSplitState(0n, BRUNO, [ANA, BRUNO, CARLA]),
    ...overrides,
  };
}

describe('buildExpenseRequest', () => {
  it('builds a request the shared schema accepts, without payer account fields for another member', () => {
    const result = buildExpenseRequest(values(), context);
    expect(result.fields).toBeUndefined();
    expect(result.request).toEqual({
      amount: '10000',
      currency: 'ARS',
      occurredAt: '2026-10-11T13:00:00.000Z',
      payerMemberId: BRUNO,
      categoryId: GROUP_CATEGORY,
      description: 'Groceries',
      split: { mode: 'equal', memberIds: [ANA, BRUNO, CARLA] },
    });
    expect(createGroupExpenseRequestSchema.safeParse(result.request).success).toBe(true);
  });

  it('refuses an archived group category', () => {
    const result = buildExpenseRequest(values(), {
      ...context,
      groupCategories: [{ id: GROUP_CATEGORY, archivedAt: '2026-10-01T00:00:00.000Z' }],
    });
    expect(result.request).toBeUndefined();
    expect(result.fields?.category).toBe('groups.expenses.form.errors.categoryRequired');
  });

  it('ignores account fields typed for a payer who is another member', () => {
    const result = buildExpenseRequest(
      values({ payerAccountId: ACCOUNT_ARS, payerCategoryId: PERSONAL_CATEGORY }),
      context,
    );
    expect(result.request).not.toHaveProperty('payerAccount');
  });

  it('requires an account and a personal category when the payer is the current user', () => {
    const result = buildExpenseRequest(values({ payerMemberId: ANA }), context);
    expect(result.request).toBeUndefined();
    expect(result.fields).toMatchObject({
      payerAccount: 'groups.expenses.form.errors.accountRequired',
      payerCategory: 'groups.expenses.form.errors.personalCategoryRequired',
    });
  });

  it('sends the payer account when the payer is the current user', () => {
    const result = buildExpenseRequest(
      values({
        payerMemberId: ANA,
        payerAccountId: ACCOUNT_ARS,
        payerCategoryId: PERSONAL_CATEGORY,
      }),
      context,
    );
    expect(result.request?.payerAccount).toEqual({
      accountId: ACCOUNT_ARS,
      categoryId: PERSONAL_CATEGORY,
    });
  });

  it('says there is no account in the currency and sends nothing', () => {
    const result = buildExpenseRequest(
      values({ payerMemberId: ANA, currency: 'USD', payerCategoryId: PERSONAL_CATEGORY }),
      context,
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.payerAccount).toBe('groups.expenses.form.errors.noAccountInCurrency');
  });

  it.each(['', '0', '0.00', 'abc', '-5', '12.345'])('rejects the amount %j', (amount) => {
    const result = buildExpenseRequest(values({ amount }), context);
    expect(result.request).toBeUndefined();
    expect(result.fields?.amount).toMatch(/^movements\.errors\.amount/);
  });

  it.each(['', '   ', 'x'.repeat(201)])('rejects the description %j', (description) => {
    const result = buildExpenseRequest(values({ description }), context);
    expect(result.request).toBeUndefined();
    expect(result.fields?.description).toMatch(/^groups\.expenses\.form\.errors\.description/);
  });

  it('trims the description', () => {
    const result = buildExpenseRequest(values({ description: '  Dinner  ' }), context);
    expect(result.request?.description).toBe('Dinner');
  });

  it('rejects a category or payer that is not among the loaded options', () => {
    const result = buildExpenseRequest(
      values({ categoryId: PERSONAL_CATEGORY, payerMemberId: '' }),
      context,
    );
    expect(result.fields?.category).toBe('groups.expenses.form.errors.categoryRequired');
    expect(result.fields?.payer).toBe('groups.expenses.form.errors.payerRequired');
  });

  it('rejects a date in the future', () => {
    const result = buildExpenseRequest(values({ occurredAt: '2026-10-13T10:00' }), context);
    expect(result.fields?.occurredAt).toBe('errors.movementDateInFuture');
  });

  it('reports the percentage difference and builds no request', () => {
    const split = {
      ...createSplitState(0n, BRUNO, [ANA, BRUNO]),
      mode: 'percentage' as const,
      values: { [ANA]: '50', [BRUNO]: '49.99' },
    };
    const result = buildExpenseRequest(values({ split }), context);
    expect(result.request).toBeUndefined();
    expect(result.difference).toBe(1n);
    expect(result.fields?.split).toBe('groups.split.errors.percentageTotal');
  });

  it('builds an exact split that adds up and counts only members with a value', () => {
    const split = {
      ...createSplitState(0n, BRUNO, [ANA, BRUNO, CARLA]),
      mode: 'exact' as const,
      values: { [ANA]: '60.00', [BRUNO]: '40.00' },
    };
    const result = buildExpenseRequest(values({ split }), context);
    expect(result.request?.split).toEqual({
      mode: 'exact',
      shares: [
        { memberId: ANA, amount: '6000' },
        { memberId: BRUNO, amount: '4000' },
      ],
    });
  });

  it('reports the remaining amount of an exact split that falls short', () => {
    const split = {
      ...createSplitState(0n, BRUNO, [ANA, BRUNO]),
      mode: 'exact' as const,
      values: { [ANA]: '60.00', [BRUNO]: '30.00' },
    };
    const result = buildExpenseRequest(values({ split }), context);
    expect(result.request).toBeUndefined();
    expect(result.difference).toBe(1000n);
  });
});

describe('initialSplitState and formatBasisPoints', () => {
  it('formats basis points as percentage text with integer arithmetic', () => {
    expect(formatBasisPoints(3333)).toBe('33.33');
    expect(formatBasisPoints(5000)).toBe('50');
    expect(formatBasisPoints(50)).toBe('0.5');
    expect(formatBasisPoints(10_000)).toBe('100');
  });

  it('prefills equal for an equal default over every member', () => {
    const state = initialSplitState({ mode: 'equal' }, [ANA, BRUNO], ANA);
    expect(state.mode).toBe('equal');
    expect(state.selectedMemberIds).toEqual([ANA, BRUNO]);
  });

  it('prefills the percentages of a percentage default and drops members who left', () => {
    const state = initialSplitState(
      {
        mode: 'percentage',
        shares: [
          { memberId: ANA, basisPoints: 7000 },
          { memberId: BRUNO, basisPoints: 2500 },
          { memberId: CARLA, basisPoints: 500 },
        ],
      },
      [ANA, BRUNO],
      ANA,
    );
    expect(state.mode).toBe('percentage');
    expect(state.values).toEqual({ [ANA]: '70', [BRUNO]: '25' });
  });
});
