import { describe, expect, it } from 'vitest';
import type { ActivityEntry, ExpenseSnapshot, SettlementSnapshot } from '@pesly/shared';
import {
  buildActivityView,
  mergeActivityPages,
  type ActivityViewContext,
  type ActivityViewNames,
} from '../src/features/groups/activity/activity-view';

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const LUIS = '44444444-4444-4444-8444-444444444444';
const CAT_FOOD = 'cat-food';
const CAT_HOME = 'cat-home';
function never(): never {
  throw new Error('missing element');
}

const NBSP = String.fromCharCode(0xa0);

const names: ActivityViewNames = {
  members: [
    { id: ANA, displayName: 'Ana' },
    { id: BRUNO, displayName: null },
  ],
  formerMembers: [{ id: LUIS, displayName: 'Luis' }],
};
const categories = [
  { id: CAT_FOOD, name: 'Food' },
  { id: CAT_HOME, name: 'Home' },
];
const ctx = (language: 'es' | 'en' = 'en'): ActivityViewContext => ({
  language,
  timeZone: 'America/Argentina/Buenos_Aires',
  unnamed: 'Unnamed member',
  neutralCategory: 'Category',
});

const expense = (overrides: Partial<ExpenseSnapshot> = {}): ExpenseSnapshot => ({
  amount: '100000',
  currency: 'ARS',
  occurredAt: '2026-10-10T15:00:00.000Z',
  categoryId: CAT_FOOD,
  description: 'Dinner',
  splitMode: 'equal',
  payerMemberId: ANA,
  shares: [
    { memberId: ANA, amount: '50000' },
    { memberId: BRUNO, amount: '50000' },
  ],
  ...overrides,
});

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'e1',
  action: 'expense_created',
  subjectType: 'expense',
  subjectId: 's1',
  memberId: ANA,
  createdAt: '2026-10-11T12:00:00.000Z',
  before: null,
  after: null,
  ...overrides,
});

describe('buildActivityView', () => {
  it('keeps the order and carries name, action, kind and instant (AC-30)', () => {
    const rows = buildActivityView(
      [
        entry({ id: 'e2', action: 'settlement_created', subjectType: 'settlement' }),
        entry({ id: 'e1' }),
      ],
      names,
      categories,
      ctx(),
    );
    expect(rows.map((r) => r.id)).toEqual(['e2', 'e1']);
    expect(rows[0]).toMatchObject({
      memberName: 'Ana',
      action: 'settlement_created',
      kind: 'settlement',
      createdAt: '2026-10-11T12:00:00.000Z',
    });
    expect(rows[1]?.kind).toBe('expense');
  });

  it('names a former member and falls back to the unnamed copy (AC-32)', () => {
    const rows = buildActivityView(
      [
        entry({ id: 'a', memberId: LUIS }),
        entry({ id: 'b', memberId: BRUNO }),
        entry({ id: 'c', memberId: 'ghost-id' }),
      ],
      names,
      categories,
      ctx(),
    );
    expect(rows.map((r) => r.memberName)).toEqual(['Luis', 'Unnamed member', 'Unnamed member']);
  });

  it('shows exactly the fields that differ, formatted in en and es (AC-35)', () => {
    const e = entry({
      action: 'expense_updated',
      before: expense(),
      after: expense({ amount: '123456', categoryId: CAT_HOME }),
    });
    const en = buildActivityView([e], names, categories, ctx('en')).at(0) ?? never();
    expect(en.details.map((d) => d.field).sort()).toEqual(['amount', 'category']);
    const amount = en.details.find((d) => d.field === 'amount') ?? never();
    expect(amount.before).toBe(`1,000.00${NBSP}ARS`);
    expect(amount.after).toBe(`1,234.56${NBSP}ARS`);
    expect(en.details.find((d) => d.field === 'category')).toMatchObject({
      before: 'Food',
      after: 'Home',
    });
    const es = buildActivityView([e], names, categories, ctx('es')).at(0) ?? never();
    expect(es.details.find((d) => d.field === 'amount')?.after).toBe(`1.234,56${NBSP}ARS`);
  });

  it('formats dates in the user time zone and shares as text', () => {
    const e = entry({
      action: 'expense_updated',
      before: expense(),
      after: expense({
        occurredAt: '2026-10-10T02:30:00.000Z',
        splitMode: 'exact',
        shares: [
          { memberId: ANA, amount: '70000' },
          { memberId: BRUNO, amount: '30000' },
        ],
      }),
    });
    const row = buildActivityView([e], names, categories, ctx('en')).at(0) ?? never();
    expect(row.details.map((d) => d.field).sort()).toEqual(['date', 'shares', 'splitMode']);
    expect(row.details.find((d) => d.field === 'date')?.after).toContain('Oct 9, 2026');
    expect(row.details.find((d) => d.field === 'shares')?.after).toBe(
      `Ana: 700.00${NBSP}ARS, Unnamed member: 300.00${NBSP}ARS`,
    );
    expect(row.details.find((d) => d.field === 'splitMode')?.after).toBe('exact');
  });

  it('shows the before values of a deletion and nothing for a creation (AC-36)', () => {
    const rows = buildActivityView(
      [
        entry({ id: 'd', action: 'expense_deleted', before: expense() }),
        entry({ id: 'c', action: 'expense_created' }),
      ],
      names,
      categories,
      ctx(),
    );
    const fields = (rows.at(0) ?? never()).details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['amount', 'description', 'category', 'payer']));
    expect((rows.at(0) ?? never()).details.find((d) => d.field === 'description')).toMatchObject({
      before: 'Dinner',
      after: null,
    });
    expect((rows.at(1) ?? never()).details).toEqual([]);
  });

  it('shows settlement fields', () => {
    const snap = (amount: string): SettlementSnapshot => ({
      fromMemberId: ANA,
      toMemberId: BRUNO,
      currency: 'USD',
      amount,
      occurredAt: '2026-10-10T15:00:00.000Z',
      legs: [],
    });
    const row =
      buildActivityView(
        [
          entry({
            action: 'settlement_updated',
            subjectType: 'settlement',
            before: snap('1000'),
            after: snap('2500'),
          }),
        ],
        names,
        categories,
        ctx(),
      ).at(0) ?? never();
    expect(row.details).toEqual([
      { field: 'amount', before: `10.00${NBSP}USD`, after: `25.00${NBSP}USD` },
    ]);
  });

  it('returns markup characters unchanged as strings (AC-30, AC-35)', () => {
    const evil = '<img src=x onerror=alert(1)> & "q"';
    const row =
      buildActivityView(
        [
          entry({
            action: 'expense_updated',
            before: expense(),
            after: expense({ description: evil }),
          }),
        ],
        { members: [{ id: ANA, displayName: '<b>Ana</b>' }], formerMembers: [] },
        categories,
        ctx(),
      ).at(0) ?? never();
    expect(row.memberName).toBe('<b>Ana</b>');
    expect(row.details[0]?.after).toBe(evil);
  });

  it('does not throw on a wrong snapshot kind or a null side (invalid input)', () => {
    const settlement: SettlementSnapshot = {
      fromMemberId: ANA,
      toMemberId: BRUNO,
      currency: 'ARS',
      amount: '1',
      occurredAt: '2026-10-10T15:00:00.000Z',
      legs: [],
    };
    const rows = buildActivityView(
      [
        entry({ id: 'x', action: 'expense_updated', before: expense(), after: null }),
        entry({ id: 'y', action: 'expense_updated', before: settlement, after: settlement }),
        entry({ id: 'z', action: 'settlement_deleted', subjectType: 'settlement', before: null }),
      ],
      names,
      categories,
      ctx(),
    );
    expect(rows.map((r) => r.details)).toEqual([[], [], []]);
  });

  it('uses the neutral copy for an unknown category, never the raw id', () => {
    const row =
      buildActivityView(
        [
          entry({
            action: 'expense_updated',
            before: expense({ categoryId: 'gone-1' }),
            after: expense({ categoryId: 'gone-2' }),
          }),
        ],
        names,
        [],
        ctx(),
      ).at(0) ?? never();
    expect(row.details[0]).toEqual({ field: 'category', before: 'Category', after: 'Category' });
  });
});

describe('mergeActivityPages', () => {
  it('appends a page and drops entries already shown (AC-31)', () => {
    const shown = [entry({ id: 'e1' }), entry({ id: 'e2' })];
    const merged = mergeActivityPages(shown, [entry({ id: 'e2' }), entry({ id: 'e3' })]);
    expect(merged.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});
