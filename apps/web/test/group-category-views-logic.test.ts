import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GroupCategoryResponse, GroupExpenseSummaryResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { formatMonth, formatShare } from '../src/features/groups/category-views/format';
import {
  currentMonth,
  monthBounds,
  offeredMonths,
} from '../src/features/groups/category-views/months';
import { resolveCategory } from '../src/features/groups/category-views/resolve-category';
import {
  buildSummaryView,
  filteredTotals,
} from '../src/features/groups/category-views/summary-view';

const BA = 'America/Argentina/Buenos_Aires';

function category(over: Partial<GroupCategoryResponse> & { id: string }): GroupCategoryResponse {
  return {
    defaultKey: null,
    name: 'Own',
    icon: 'utensils',
    color: 'red',
    archivedAt: null,
    ...over,
  };
}

function summary(
  currencies: GroupExpenseSummaryResponse['currencies'],
  categories: GroupCategoryResponse[],
): GroupExpenseSummaryResponse {
  return {
    from: '2026-10-01T03:00:00.000Z',
    to: '2026-11-01T02:59:59.999Z',
    currencies,
    categories,
  };
}

describe('resolveCategory', () => {
  it('a default-key category without a name resolves to its translated default name', () => {
    const cat = category({ id: 'a', defaultKey: 'food', name: null });
    const es = resolveCategory('a', [cat], 'es');
    const en = resolveCategory('a', [cat], 'en');
    expect(es.label).not.toBe('');
    expect(es.label).toBe('Comida');
    expect(en.label).toBe('Food');
    expect(en.label).not.toBe(es.label);
    expect(resolveCategory('b', [category({ id: 'b', name: 'Mine' })], 'es').label).toBe('Mine');
  });

  it('resolves icon and color, and marks an archived category', () => {
    const live = resolveCategory('a', [category({ id: 'a', icon: 'car', color: 'blue' })], 'en');
    expect(live).toMatchObject({ icon: 'car', color: 'blue', archived: false, known: true });
    const old = resolveCategory(
      'a',
      [category({ id: 'a', archivedAt: '2026-01-01T00:00:00.000Z' })],
      'en',
    );
    expect(old.archived).toBe(true);
  });

  it('an id that is not in the list is the neutral fallback, never the raw id', () => {
    const d = resolveCategory('0000-missing', [], 'en', 'No category');
    expect(d.known).toBe(false);
    expect(d.label).toBe('No category');
    expect(d.label).not.toContain('missing');
    expect(d.icon).toBe('unknown');
    expect(d.color).toBe('neutral');
    expect(d.archived).toBe(false);
  });
});

describe('months', () => {
  it('current month follows the user zone, not UTC', () => {
    // 2026-11-01T02:30Z is still 31 October 23:30 in Buenos Aires.
    expect(currentMonth(new Date('2026-11-01T02:30:00.000Z'), BA)).toBe('2026-10');
    expect(currentMonth(new Date('2026-11-01T03:00:00.000Z'), BA)).toBe('2026-11');
  });

  it('offers 121 months, newest first, none in the future', () => {
    const months = offeredMonths(new Date('2026-11-01T02:30:00.000Z'), BA);
    expect(months).toHaveLength(121);
    expect(months[0]).toBe('2026-10');
    expect(months[1]).toBe('2026-09');
    expect(months[120]).toBe('2016-10');
    expect(months.every((m) => m <= '2026-10')).toBe(true);
    expect(new Set(months).size).toBe(121);
    const jan = offeredMonths(new Date('2027-01-15T12:00:00.000Z'), BA);
    expect(jan[1]).toBe('2026-12');
  });

  it.each([
    ['2026-10', '2026-10-31T23:59', '2026-11-01T00:00'],
    ['2026-09', '2026-09-30T23:59', '2026-10-01T00:00'],
    ['2026-02', '2026-02-28T23:59', '2026-03-01T00:00'],
    ['2028-02', '2028-02-29T23:59', '2028-03-01T00:00'],
  ])('monthBounds of %s covers the local month exactly', (month, lastLocal, nextLocal) => {
    const { from, to } = monthBounds(month, BA);
    const ms = (iso: string) => Date.parse(iso);
    const at = (local: string) => Date.parse(`${local}:00-03:00`);
    expect(ms(from)).toBe(at(`${month}-01T00:00`));
    expect(ms(to)).toBe(at(nextLocal) - 1);
    expect(ms(to)).toBeGreaterThanOrEqual(at(lastLocal));
    expect(from).toMatch(/Z$/);
    expect(ms(to)).toBeLessThan(at(nextLocal));
  });

  it('monthBounds rolls the year over in December', () => {
    const { to } = monthBounds('2026-12', BA);
    expect(Date.parse(to)).toBe(Date.parse('2027-01-01T00:00:00-03:00') - 1);
  });
});

describe('buildSummaryView', () => {
  const food = category({ id: 'f', name: 'Food' });
  const bills = category({ id: 'b', name: 'Bills', icon: 'zap' });
  const old = category({ id: 'o', name: 'Old', archivedAt: '2026-01-01T00:00:00.000Z' });

  it('keeps each currency apart with its own lines and total', () => {
    const view = buildSummaryView(
      summary(
        [
          {
            currency: 'ARS',
            total: '1500',
            count: 3,
            categories: [
              { categoryId: 'f', total: '1000', count: 2 },
              { categoryId: 'b', total: '500', count: 1 },
            ],
          },
          {
            currency: 'USD',
            total: '300',
            count: 1,
            categories: [{ categoryId: 'f', total: '300', count: 1 }],
          },
        ],
        [food, bills],
      ),
      'en',
    );
    expect(view.currencies.map((c) => c.currency)).toEqual(['ARS', 'USD']);
    expect(view.currencies[0]?.total).toBe(1500n);
    expect(view.currencies[0]?.lines.map((l) => l.total)).toEqual([1000n, 500n]);
    expect(view.currencies[1]?.total).toBe(300n);
    expect(view.currencies[1]?.lines).toHaveLength(1);
    expect(view.currencies[0]?.lines[0]?.shareBasisPoints).toBe(6667);
    expect(view.currencies[0]?.lines[1]?.shareBasisPoints).toBe(3333);
    expect(view.currencies[1]?.lines[0]?.shareBasisPoints).toBe(10000);
  });

  it('empty currencies is an empty view', () => {
    expect(buildSummaryView(summary([], []), 'en').currencies).toEqual([]);
  });

  it('orders equal totals by name in the active language', () => {
    const a = category({ id: 'z1', name: 'Zeta' });
    const b = category({ id: 'a1', name: 'Alfa' });
    const view = buildSummaryView(
      summary(
        [
          {
            currency: 'ARS',
            total: '200',
            count: 2,
            categories: [
              { categoryId: 'z1', total: '100', count: 1 },
              { categoryId: 'a1', total: '100', count: 1 },
            ],
          },
        ],
        [a, b],
      ),
      'es',
    );
    expect(view.currencies[0]?.lines.map((l) => l.display.label)).toEqual(['Alfa', 'Zeta']);
  });

  it('name ties are case-insensitive in English', () => {
    const view = buildSummaryView(
      summary(
        [
          {
            currency: 'ARS',
            total: '20',
            count: 2,
            categories: [
              { categoryId: 'x', total: '10', count: 1 },
              { categoryId: 'y', total: '10', count: 1 },
            ],
          },
        ],
        [category({ id: 'x', name: 'Beta' }), category({ id: 'y', name: 'alpha' })],
      ),
      'en',
    );
    expect(view.currencies[0]?.lines.map((l) => l.display.label)).toEqual(['alpha', 'Beta']);
  });

  it('marks an archived line and merges unknown ids into one No category line', () => {
    const view = buildSummaryView(
      summary(
        [
          {
            currency: 'ARS',
            total: '600',
            count: 4,
            categories: [
              { categoryId: 'o', total: '300', count: 1 },
              { categoryId: 'm1', total: '200', count: 2 },
              { categoryId: 'm2', total: '100', count: 1 },
            ],
          },
        ],
        [old],
      ),
      'en',
      'No category',
    );
    const lines = view.currencies[0]?.lines ?? [];
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.key === 'o')?.display.archived).toBe(true);
    const merged = lines.find((l) => !l.display.known);
    expect(merged?.total).toBe(300n);
    expect(merged?.count).toBe(3);
    expect(merged?.categoryIds).toEqual(['m1', 'm2']);
    expect(merged?.display.label).toBe('No category');
    expect(lines.reduce((s, l) => s + l.total, 0n)).toBe(view.currencies[0]?.total);
  });

  it('a zero currency total gives 0 shares without dividing', () => {
    const view = buildSummaryView(
      summary(
        [
          {
            currency: 'ARS',
            total: '0',
            count: 1,
            categories: [{ categoryId: 'f', total: '0', count: 1 }],
          },
        ],
        [food],
      ),
      'en',
    );
    expect(view.currencies[0]?.lines[0]?.shareBasisPoints).toBe(0);
  });
});

describe('filteredTotals', () => {
  const view = buildSummaryView(
    summary(
      [
        {
          currency: 'ARS',
          total: '1500',
          count: 4,
          categories: [
            { categoryId: 'f', total: '1000', count: 2 },
            { categoryId: 'b', total: '400', count: 1 },
            { categoryId: 'c', total: '100', count: 1 },
          ],
        },
        {
          currency: 'USD',
          total: '300',
          count: 1,
          categories: [{ categoryId: 'f', total: '300', count: 1 }],
        },
      ],
      [
        category({ id: 'f', name: 'Food' }),
        category({ id: 'b', name: 'Bills' }),
        category({ id: 'c', name: 'Cars' }),
      ],
    ),
    'en',
  );

  it('one category equals that line, per currency', () => {
    expect(filteredTotals(view, ['f'])).toEqual([
      { currency: 'ARS', total: 1000n, count: 2 },
      { currency: 'USD', total: 300n, count: 1 },
    ]);
  });

  it('two categories sum per currency and skip currencies with no selected line', () => {
    expect(filteredTotals(view, ['b', 'c'])).toEqual([{ currency: 'ARS', total: 500n, count: 2 }]);
  });

  it('no match is empty', () => {
    expect(filteredTotals(view, ['nope'])).toEqual([]);
  });
});

describe('format', () => {
  it('formats the month in es and en', () => {
    expect(formatMonth('2026-10', 'en')).toBe('October 2026');
    expect(formatMonth('2026-10', 'es').toLowerCase()).toContain('octubre');
    expect(formatMonth('2026-10', 'es')).toContain('2026');
  });

  it('formats shares with the locale separators', () => {
    expect(formatShare(2333, 'en')).toBe('23.33%');
    expect(formatShare(2333, 'es')).toContain('23,33');
    expect(formatShare(10000, 'en')).toBe('100%');
    expect(formatShare(0, 'en')).toBe('0%');
  });
});

describe('source scan', () => {
  it('no parseFloat, toFixed or Number( outside format.ts', () => {
    const dir = join(__dirname, '../src/features/groups/category-views');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/parseFloat|toFixed/);
      if (file !== 'format.ts') expect(text, file).not.toMatch(/\bNumber\(/);
    }
  });
});
