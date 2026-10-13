import type { BudgetResponse, BudgetSpendingResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '../src/lib/api-client';
import { budgetFailureKey, isMonthInFuture } from '../src/features/budgets/helpers/budget-failure';
import {
  canGoNext,
  canGoPrevious,
  initialMonthState,
  isMonthAfter,
  isValidMonth,
  nextMonth,
  previousMonth,
  queryMonth,
  selectMonth,
} from '../src/features/budgets/helpers/budget-month';
import {
  buildCreateBudget,
  buildUpdateBudget,
  defaultThresholds,
  type BudgetFormState,
} from '../src/features/budgets/helpers/budget-request';
import {
  addThreshold,
  canAddThreshold,
  removeThreshold,
} from '../src/features/budgets/helpers/budget-thresholds';
import { toBudgetView } from '../src/features/budgets/helpers/budget-view';

const CAT_A = '00000000-0000-4000-8000-0000000000a1';
const CAT_B = '00000000-0000-4000-8000-0000000000b2';

function spending(overrides: Partial<BudgetSpendingResponse> = {}): BudgetSpendingResponse {
  return {
    budgetId: '00000000-0000-4000-8000-000000000001',
    name: 'Food',
    currency: 'ARS',
    month: '2026-10',
    amount: '100000',
    rolloverEnabled: false,
    rolloverAmount: '0',
    available: '100000',
    spent: '25000',
    remaining: '75000',
    percentUsed: 25,
    thresholds: [80, 100],
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
    ...overrides,
  };
}

function budget(overrides: Partial<BudgetResponse> = {}): BudgetResponse {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Food',
    amount: '100000',
    currency: 'ARS',
    rollover: false,
    thresholds: [80, 100],
    categoryIds: [CAT_A, CAT_B],
    coveredCategoryIds: [CAT_A, CAT_B],
    effectiveFrom: '2026-10-01',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<BudgetFormState> = {}): BudgetFormState {
  return {
    name: 'Food',
    amount: '1.000,00',
    currency: 'ARS',
    categoryIds: [CAT_A, CAT_B],
    rollover: false,
    thresholds: defaultThresholds(),
    ...overrides,
  };
}

function failure(code: ApiFailure['code'], messageKey: ApiFailure['messageKey']): ApiFailure {
  return { ok: false, code, messageKey };
}

describe('toBudgetView', () => {
  it('gives name, currency and the four figures as bigint and the percentage as received', () => {
    const view = toBudgetView(spending());
    expect(view.name).toBe('Food');
    expect(view.currency).toBe('ARS');
    expect(view.amount).toBe(100000n);
    expect(view.available).toBe(100000n);
    expect(view.spent).toBe(25000n);
    expect(view.remaining).toBe(75000n);
    expect(view.percentage).toBe(25);
    expect(view.overBudget).toBe(false);
  });

  it('puts markers at 80 and 100 for thresholds 80 and 100', () => {
    const view = toBudgetView(spending());
    expect(view.markers).toEqual([
      { value: 80, position: 80, label: '80' },
      { value: 100, position: 100, label: '100' },
    ]);
  });

  it('clamps a threshold above 100 to the bar edge and keeps its label', () => {
    const view = toBudgetView(spending({ thresholds: [150] }));
    expect(view.markers).toEqual([{ value: 150, position: 100, label: '150' }]);
  });

  it('gives overBudget, the negative bigint and a full bar for a negative remaining', () => {
    const view = toBudgetView(spending({ spent: '120000', remaining: '-20000', percentUsed: 120 }));
    expect(view.overBudget).toBe(true);
    expect(view.remaining).toBe(-20000n);
    expect(view.barWidth).toBe(100);
  });

  it('keeps a percentage of 1000 as received with a bar width of 100', () => {
    const view = toBudgetView(spending({ percentUsed: 1000, remaining: '-900000' }));
    expect(view.percentage).toBe(1000);
    expect(view.barWidth).toBe(100);
  });

  it('keeps the rollover amount and the available amount as returned', () => {
    const view = toBudgetView(
      spending({ rolloverEnabled: true, rolloverAmount: '5000', available: '105000' }),
    );
    expect(view.rolloverEnabled).toBe(true);
    expect(view.rolloverAmount).toBe(5000n);
    expect(view.available).toBe(105000n);
    expect(view.amount).toBe(100000n);
  });

  it('keeps the unconverted shares count and 0 is falsy', () => {
    expect(toBudgetView(spending({ unconvertedShareCount: 3 })).unconvertedShareCount).toBe(3);
    expect(Boolean(toBudgetView(spending()).unconvertedShareCount)).toBe(false);
  });

  it('keeps the budget id and month', () => {
    const view = toBudgetView(spending());
    expect(view.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(view.month).toBe('2026-10');
  });
});

describe('budget month', () => {
  it('steps back across a year boundary', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
  });

  it('stops at 1971-01', () => {
    expect(previousMonth('1971-01')).toBeNull();
    expect(canGoPrevious('1971-01')).toBe(false);
    expect(canGoPrevious('1971-02')).toBe(true);
    expect(previousMonth('1971-02')).toBe('1971-01');
  });

  it('has no next step on the current month', () => {
    const month = initialMonthState('2026-10');
    expect(canGoNext(month)).toBe(false);
    expect(nextMonth(month)).toBeNull();
  });

  it('walks back and forth and sends no month for the current one', () => {
    const start = initialMonthState('2026-10');
    expect(queryMonth(start)).toBeUndefined();
    const back = selectMonth(start, previousMonth(start.selected) ?? start.selected);
    expect(back).toEqual({ current: '2026-10', selected: '2026-09' });
    expect(queryMonth(back)).toBe('2026-09');
    expect(canGoNext(back)).toBe(true);
    expect(nextMonth(back)).toBe('2026-10');
    expect(nextMonth({ current: '2026-10', selected: '2025-12' })).toBe('2026-01');
    expect(queryMonth(selectMonth(back, '2026-10'))).toBeUndefined();
  });

  it('validates the YYYY-MM shape and compares months', () => {
    expect(isValidMonth('2026-10')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('1970-12')).toBe(false);
    expect(isValidMonth('2026-1')).toBe(false);
    expect(isValidMonth('soon')).toBe(false);
    expect(isMonthAfter('2026-11', '2026-10')).toBe(true);
    expect(isMonthAfter('2026-10', '2026-10')).toBe(false);
    expect(isMonthAfter('2025-12', '2026-01')).toBe(false);
  });
});

describe('thresholds editor', () => {
  it('accepts 90 and keeps the list ascending', () => {
    expect(addThreshold([80, 100], '90')).toEqual({ list: [80, 90, 100] });
    expect(addThreshold([80, 100], ' 150 ')).toEqual({ list: [80, 100, 150] });
  });

  it('rejects 0, 201, a decimal, text and an empty input', () => {
    const invalid = { error: 'budgets.form.errors.thresholdInvalid' };
    expect(addThreshold([80], '0')).toEqual(invalid);
    expect(addThreshold([80], '201')).toEqual(invalid);
    expect(addThreshold([80], '1.5')).toEqual(invalid);
    expect(addThreshold([80], '1,5')).toEqual(invalid);
    expect(addThreshold([80], 'abc')).toEqual(invalid);
    expect(addThreshold([80], '-5')).toEqual(invalid);
    expect(addThreshold([80], '')).toEqual(invalid);
  });

  it('rejects a duplicate', () => {
    expect(addThreshold([80, 100], '80')).toEqual({
      error: 'budgets.form.errors.thresholdDuplicate',
    });
  });

  it('refuses a sixth threshold', () => {
    const five = [10, 20, 30, 40, 50];
    expect(canAddThreshold(five)).toBe(false);
    expect(canAddThreshold(five.slice(0, 4))).toBe(true);
    expect(addThreshold(five, '60')).toEqual({ error: 'budgets.form.errors.thresholdsTooMany' });
  });

  it('removes a value', () => {
    expect(removeThreshold([80, 90, 100], 90)).toEqual([80, 100]);
    expect(removeThreshold([80], 80)).toEqual([]);
  });

  it('removing the last threshold makes the builder return an input error', () => {
    const result = buildCreateBudget(state({ thresholds: removeThreshold([80], 80) }), 'es-AR');
    expect(result.request).toBeUndefined();
    expect(result.errors?.thresholds).toBe('budgets.form.errors.thresholdsRequired');
  });
});

describe('buildCreateBudget', () => {
  it('builds the body with the default thresholds when none changed', () => {
    const result = buildCreateBudget(state({ name: '  Food  ' }), 'es-AR');
    expect(result).toEqual({
      request: {
        name: 'Food',
        amount: '100000',
        currency: 'ARS',
        categoryIds: [CAT_A, CAT_B],
        rollover: false,
        thresholds: [80, 100],
      },
    });
  });

  it('carries rollover and sorted thresholds', () => {
    const result = buildCreateBudget(
      state({ rollover: true, currency: 'USD', amount: '1,000.00', thresholds: [100, 50] }),
      'en-US',
    );
    expect(result.request).toMatchObject({
      rollover: true,
      currency: 'USD',
      thresholds: [50, 100],
      amount: '100000',
    });
  });

  it('does not mutate the default thresholds list', () => {
    defaultThresholds().push(1);
    expect(defaultThresholds()).toEqual([80, 100]);
  });

  it('rejects an empty name and a name of 51 characters', () => {
    const empty = buildCreateBudget(state({ name: '   ' }), 'es-AR');
    expect(empty.request).toBeUndefined();
    expect(empty.errors?.name).toBe('budgets.form.errors.nameRequired');
    const long = buildCreateBudget(state({ name: 'x'.repeat(51) }), 'es-AR');
    expect(long.request).toBeUndefined();
    expect(long.errors?.name).toBe('budgets.form.errors.nameTooLong');
    expect(buildCreateBudget(state({ name: 'x'.repeat(50) }), 'es-AR').request).toBeDefined();
  });

  it('rejects an empty, zero or non-numeric amount', () => {
    for (const amount of ['', '0', '0,00', 'abc', '-5']) {
      const result = buildCreateBudget(state({ amount }), 'es-AR');
      expect(result.request).toBeUndefined();
      expect(result.errors?.amount).toBe('budgets.form.errors.amountInvalid');
    }
  });

  it('rejects no category and more than 50', () => {
    const none = buildCreateBudget(state({ categoryIds: [] }), 'es-AR');
    expect(none.request).toBeUndefined();
    expect(none.errors?.categoryIds).toBe('budgets.form.errors.categoriesRequired');
    const many = Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(buildCreateBudget(state({ categoryIds: many }), 'es-AR').errors?.categoryIds).toBe(
      'budgets.form.errors.categoriesRequired',
    );
  });

  it('reports every invalid field at once', () => {
    const result = buildCreateBudget(state({ name: '', amount: '', categoryIds: [] }), 'es-AR');
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(['amount', 'categoryIds', 'name']);
  });
});

describe('buildUpdateBudget', () => {
  it('returns no body when nothing changed, comparing categories as a set', () => {
    const original = budget();
    const result = buildUpdateBudget(
      state({ categoryIds: [CAT_B, CAT_A], thresholds: [100, 80] }),
      original,
      'es-AR',
    );
    expect(result).toEqual({ unchanged: true });
  });

  it('sends only the changed fields', () => {
    const original = budget();
    expect(buildUpdateBudget(state({ name: 'Rent' }), original, 'es-AR')).toEqual({
      request: { name: 'Rent' },
    });
    expect(buildUpdateBudget(state({ amount: '2.000,00' }), original, 'es-AR')).toEqual({
      request: { amount: '200000' },
    });
    expect(buildUpdateBudget(state({ rollover: true }), original, 'es-AR')).toEqual({
      request: { rollover: true },
    });
    expect(buildUpdateBudget(state({ thresholds: [50, 100] }), original, 'es-AR')).toEqual({
      request: { thresholds: [50, 100] },
    });
    expect(buildUpdateBudget(state({ categoryIds: [CAT_A] }), original, 'es-AR')).toEqual({
      request: { categoryIds: [CAT_A] },
    });
  });

  it('never sends the currency', () => {
    const result = buildUpdateBudget(state({ currency: 'USD', name: 'Rent' }), budget(), 'es-AR');
    expect(result.request).toEqual({ name: 'Rent' });
  });

  it('returns input errors for invalid values', () => {
    const result = buildUpdateBudget(state({ name: '', thresholds: [] }), budget(), 'es-AR');
    expect(result.request).toBeUndefined();
    expect(result.errors?.name).toBe('budgets.form.errors.nameRequired');
    expect(result.errors?.thresholds).toBe('budgets.form.errors.thresholdsRequired');
  });
});

describe('budgetFailureKey', () => {
  it('maps the refused 51st budget, the invalid category kind and the future month', () => {
    expect(budgetFailureKey(failure('BUDGET_LIMIT_REACHED', 'budgetLimitReached'))).toEqual({
      kind: 'message',
      key: 'errors.budgetLimitReached',
    });
    expect(
      budgetFailureKey(failure('BUDGET_CATEGORY_KIND_INVALID', 'budgetCategoryKindInvalid')),
    ).toEqual({ kind: 'message', key: 'errors.budgetCategoryKindInvalid' });
    expect(budgetFailureKey(failure('BUDGET_MONTH_IN_FUTURE', 'budgetMonthInFuture'))).toEqual({
      kind: 'message',
      key: 'errors.budgetMonthInFuture',
    });
  });

  it('maps a network failure to offline and a 404 to not found', () => {
    expect(budgetFailureKey(failure('NETWORK', 'network'))).toEqual({
      kind: 'offline',
      key: 'errors.network',
    });
    expect(budgetFailureKey(failure('NOT_FOUND', 'unexpected'))).toEqual({ kind: 'not-found' });
  });

  it('detects the future month refusal only', () => {
    expect(isMonthInFuture(failure('BUDGET_MONTH_IN_FUTURE', 'budgetMonthInFuture'))).toBe(true);
    expect(isMonthInFuture(failure('NETWORK', 'network'))).toBe(false);
  });
});
