import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { budgetSpendingQuerySchema, defaultCategoryNames } from '@pesly/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BudgetMonthInFuture } from '../../src/budgets/domain/errors';
import { monthBounds, monthOf, monthStartOf, previousMonth } from '../../src/budgets/domain/month';
import {
  computeBudgetSpending,
  convertAmount,
  effectiveNames,
  namesMatch,
  percentUsed,
  spendingOf,
  type PersonalRow,
  type ShareRow,
} from '../../src/budgets/domain/spending';
import { effectiveNames as categoryEffectiveNames } from '../../src/categories/domain/category';
import { createErrorHandler } from '../../src/shared/http/error-handler';
import { validate } from '../../src/shared/http/validate';
import { createLogger } from '../../src/shared/logging/logger';

const BA = 'America/Argentina/Buenos_Aires';
const FOOD = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';
const OTHER = '1c1a7a1f-9d2e-4d9f-8b64-4e2a3b0d6c22';

function personal(overrides: Partial<PersonalRow> = {}): PersonalRow {
  return { categoryId: FOOD, currency: 'ARS', rate: 15000000n, sum: 5000000n, ...overrides };
}

function share(overrides: Partial<ShareRow> = {}): ShareRow {
  return {
    categoryName: 'Food',
    categoryDefaultKey: null,
    currency: 'ARS',
    rate: null,
    sum: 1000000n,
    ...overrides,
  };
}

const coveredIds = new Set([FOOD]);
const coveredNames = ['Food'];

describe('month helpers (AC-15, AC-16)', () => {
  it('monthOf, previousMonth and monthStartOf', () => {
    expect(monthOf('2026-10-15')).toBe('2026-10');
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
    expect(monthStartOf('2026-10')).toBe('2026-10-01');
  });

  it.each(['2026-13', '2026-1', '', '2026-10-01', 'abcd-ef'])('throws on the month %j', (m) => {
    expect(() => previousMonth(m)).toThrow();
    expect(() => monthStartOf(m)).toThrow();
    expect(() => monthBounds(m, BA)).toThrow();
  });

  it('monthOf throws on a malformed date', () => {
    expect(() => monthOf('2026-10')).toThrow();
    expect(() => monthOf('nope')).toThrow();
  });
});

describe('monthBounds (AC-03)', () => {
  it('starts and ends at midnight of the user zone', () => {
    const { from, to } = monthBounds('2026-10', BA);
    expect(from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(new Date('2026-10-01T01:00:00Z').getTime()).toBeLessThan(from.getTime());
  });

  it('rolls over the year', () => {
    const { from, to } = monthBounds('2026-12', 'UTC');
    expect(from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('falls back to 01:00 when midnight does not exist', () => {
    // Paraguay moved its clocks from 00:00 to 01:00 on 2023-10-01, so that midnight never happened.
    const { from } = monthBounds('2023-10', 'America/Asuncion');
    expect(from.toISOString()).toBe('2023-10-01T04:00:00.000Z');
  });
});

describe('names (AC-10, AC-11)', () => {
  it('matches case-insensitively and in NFC, not by prefix', () => {
    expect(namesMatch('Food', 'food')).toBe(true);
    expect(namesMatch('Food', 'Foods')).toBe(false);
    expect(namesMatch('Café', 'café')).toBe(true);
  });

  it('a default with no custom name answers to both language names', () => {
    const { es, en } = defaultCategoryNames('food');
    expect(effectiveNames({ name: null, defaultKey: 'food' })).toEqual([es, en]);
    expect(effectiveNames({ name: 'Mine', defaultKey: 'food' })).toEqual(['Mine']);
    expect(effectiveNames({ name: null, defaultKey: null })).toEqual([]);
  });

  it('is in parity with the categories module', () => {
    const samples = [
      { name: 'Food', defaultKey: null },
      { name: null, defaultKey: 'food' },
      { name: 'Renamed', defaultKey: 'food' },
      { name: null, defaultKey: null },
    ];
    for (const sample of samples) {
      const category = {
        id: FOOD,
        kind: 'expense',
        parentId: null,
        icon: 'tag',
        color: 'blue',
        archivedAt: null,
        createdAt: new Date(0),
        ...sample,
      } as unknown as Parameters<typeof categoryEffectiveNames>[0];
      expect(effectiveNames(sample)).toEqual(categoryEffectiveNames(category));
    }
  });
});

describe('convertAmount (AC-07, AC-08, AC-28)', () => {
  it('returns the amount in the same currency whatever the rate', () => {
    expect(convertAmount(123n, 'ARS', 'ARS', null)).toBe(123n);
    expect(convertAmount(123n, 'USD', 'USD', 15000000n)).toBe(123n);
  });

  it('converts USD to ARS and ARS to USD', () => {
    expect(convertAmount(2000n, 'USD', 'ARS', 15000000n)).toBe(3000000n);
    expect(convertAmount(3000000n, 'ARS', 'USD', 15000000n)).toBe(2000n);
  });

  it('returns null with no rate across currencies', () => {
    expect(convertAmount(2000n, 'USD', 'ARS', null)).toBeNull();
  });

  it('rejects a rate of 0 or less', () => {
    expect(() => convertAmount(1n, 'USD', 'ARS', 0n)).toThrow();
    expect(() => convertAmount(1n, 'USD', 'ARS', -1n)).toThrow();
  });

  it('does not overflow near the largest int64', () => {
    const max = 9223372036854775807n;
    expect(convertAmount(max, 'USD', 'ARS', 15000000n)).toBe((max * 15000000n + 5000n) / 10000n);
  });
});

describe('spendingOf (AC-01, AC-04, AC-05, AC-12)', () => {
  it('adds a personal expense and a share', () => {
    const result = spendingOf('ARS', coveredIds, coveredNames, [personal()], [share()]);
    expect(result).toEqual({ spent: 6000000n, unconvertedShareCount: 0 });
  });

  it('ignores categories outside the covered set and unmatched share names', () => {
    const result = spendingOf(
      'ARS',
      coveredIds,
      coveredNames,
      [personal({ categoryId: OTHER })],
      [share({ categoryName: 'Travel' })],
    );
    expect(result.spent).toBe(0n);
  });

  it('matches a share through the default key names', () => {
    const { en } = defaultCategoryNames('food');
    const result = spendingOf(
      'ARS',
      new Set(),
      [en],
      [],
      [share({ categoryName: null, categoryDefaultKey: 'food' })],
    );
    expect(result.spent).toBe(1000000n);
  });

  it('no rows give 0', () => {
    expect(spendingOf('ARS', coveredIds, coveredNames, [], [])).toEqual({
      spent: 0n,
      unconvertedShareCount: 0,
    });
  });

  it('converts a personal USD row with its frozen rate', () => {
    const result = spendingOf(
      'ARS',
      coveredIds,
      coveredNames,
      [personal({ currency: 'USD', sum: 2000n })],
      [],
    );
    expect(result.spent).toBe(3000000n);
  });

  it('counts a USD share with no rate as unconverted, not summed', () => {
    const result = spendingOf(
      'ARS',
      coveredIds,
      coveredNames,
      [],
      [share({ currency: 'USD', rate: null, sum: 2000n })],
    );
    expect(result).toEqual({ spent: 0n, unconvertedShareCount: 1 });
  });

  it('converts a USD share that carries a rate', () => {
    const result = spendingOf(
      'ARS',
      coveredIds,
      coveredNames,
      [],
      [share({ currency: 'USD', rate: 15000000n, sum: 2000n })],
    );
    expect(result).toEqual({ spent: 3000000n, unconvertedShareCount: 0 });
  });

  it('throws on a personal row in another currency with no rate', () => {
    expect(() =>
      spendingOf('ARS', coveredIds, coveredNames, [personal({ currency: 'USD', rate: null })], []),
    ).toThrow();
  });
});

describe('percentUsed and computeBudgetSpending (AC-13, AC-14, AC-18 to AC-22)', () => {
  it('computes the percentage rounded down and capped', () => {
    expect(percentUsed(12000000n, 15000000n)).toBe(80);
    expect(percentUsed(0n, 15000000n)).toBe(0);
    expect(percentUsed(14999999n, 15000000n)).toBe(99);
    expect(percentUsed(1500000000n, 15000000n)).toBe(1000);
    expect(percentUsed(-5n, 15000000n)).toBe(0);
    expect(() => percentUsed(1n, 0n)).toThrow();
  });

  const input = {
    currency: 'ARS' as const,
    current: { amount: 15000000n, rollover: false },
    previous: null,
    spentCurrent: 0n,
    spentPrevious: 0n,
  };

  it('80 percent and remaining 3000000', () => {
    expect(computeBudgetSpending({ ...input, spentCurrent: 12000000n })).toEqual({
      rolloverAmount: 0n,
      available: 15000000n,
      remaining: 3000000n,
      percentUsed: 80,
    });
  });

  it('overspend gives negative remaining and 120', () => {
    const r = computeBudgetSpending({ ...input, spentCurrent: 18000000n });
    expect(r.remaining).toBe(-3000000n);
    expect(r.percentUsed).toBe(120);
  });

  it('caps at 1000', () => {
    expect(computeBudgetSpending({ ...input, spentCurrent: 1500000000n }).percentUsed).toBe(1000);
  });

  it('no rows: remaining equals available', () => {
    const r = computeBudgetSpending(input);
    expect(r.remaining).toBe(r.available);
  });

  it('rollover on carries the previous leftover', () => {
    const r = computeBudgetSpending({
      ...input,
      current: { amount: 15000000n, rollover: true },
      previous: { amount: 15000000n },
      spentPrevious: 13000000n,
    });
    expect(r.rolloverAmount).toBe(2000000n);
    expect(r.available).toBe(17000000n);
  });

  it('rollover on and a previous overspend carries 0', () => {
    const r = computeBudgetSpending({
      ...input,
      current: { amount: 15000000n, rollover: true },
      previous: { amount: 15000000n },
      spentPrevious: 20000000n,
    });
    expect(r.rolloverAmount).toBe(0n);
    expect(r.available).toBe(15000000n);
  });

  it('rollover off ignores the previous month', () => {
    const r = computeBudgetSpending({
      ...input,
      previous: { amount: 15000000n },
      spentPrevious: 1n,
    });
    expect(r.rolloverAmount).toBe(0n);
    expect(r.available).toBe(15000000n);
  });

  it('rollover on with no previous version carries 0', () => {
    const r = computeBudgetSpending({ ...input, current: { amount: 15000000n, rollover: true } });
    expect(r.rolloverAmount).toBe(0n);
    expect(r.available).toBe(15000000n);
  });
});

describe('typed error and HTTP (AC-16)', () => {
  const logger = createLogger({ level: 'silent' });

  it('BudgetMonthInFuture maps to 400 BUDGET_MONTH_IN_FUTURE', async () => {
    const app = express();
    app.get('/x', () => {
      throw new BudgetMonthInFuture();
    });
    app.use(createErrorHandler(logger));
    const response = await request(app).get('/x');
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('BUDGET_MONTH_IN_FUTURE');
  });

  it('a malformed month fails the shared validation with 400 VALIDATION_FAILED', async () => {
    const app = express();
    app.get(
      '/x',
      validate({ query: budgetSpendingQuerySchema }, () => undefined),
    );
    app.use(createErrorHandler(logger));
    const response = await request(app).get('/x?month=2026-13');
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('no float in the calculation (AC-28)', () => {
  it('the domain source uses no float, Number conversion or infrastructure import', () => {
    for (const file of ['spending.ts', 'month.ts']) {
      const source = readFileSync(join(__dirname, '../../src/budgets/domain', file), 'utf8');
      expect(source).not.toMatch(/parseFloat|toFixed|Number\(|Math\./);
      expect(source).not.toMatch(/infrastructure/);
    }
  });
});
