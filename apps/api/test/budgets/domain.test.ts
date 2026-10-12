import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@pesly/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mergeVersion, versionInForce, type BudgetVersion } from '../../src/budgets/domain/budget';
import { BudgetCategoryKindInvalid, BudgetLimitReached } from '../../src/budgets/domain/errors';
import { currentMonthStart } from '../../src/budgets/domain/month';
import { normalizeThresholds } from '../../src/budgets/domain/thresholds';
import { createErrorHandler } from '../../src/shared/http/error-handler';
import { createLogger } from '../../src/shared/logging/logger';

const CAT_A = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';
const CAT_B = '1c1a7a1f-9d2e-4d9f-8b64-4e2a3b0d6c22';
const BA = 'America/Argentina/Buenos_Aires';

function version(effectiveFrom: string, overrides: Partial<BudgetVersion> = {}): BudgetVersion {
  return {
    effectiveFrom,
    name: 'Outings',
    amount: 15000000n,
    rollover: false,
    categoryIds: [CAT_A],
    thresholds: [80, 100],
    ...overrides,
  };
}

describe('normalizeThresholds (AC-09, AC-10)', () => {
  it('defaults to 80 and 100 when omitted', () => {
    expect(normalizeThresholds()).toEqual([80, 100]);
    expect(normalizeThresholds(undefined)).toEqual([80, 100]);
  });

  it('sorts ascending without mutating the input', () => {
    const input = [120, 50, 80];
    expect(normalizeThresholds(input)).toEqual([50, 80, 120]);
    expect(input).toEqual([120, 50, 80]);
  });

  it.each([[[]], [[0]], [[201]], [[1.5]], [[50, 50]], [[1, 2, 3, 4, 5, 6]]])(
    'throws VALIDATION_FAILED for %j (AC-11)',
    (value) => {
      let caught: unknown;
      try {
        normalizeThresholds(value);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe('VALIDATION_FAILED');
    },
  );

  it('accepts the bounds 1 and 200', () => {
    expect(normalizeThresholds([200, 1])).toEqual([1, 200]);
  });
});

describe('currentMonthStart (D3)', () => {
  it('uses the zone of the caller when UTC is already the next month', () => {
    // 2026-10-31 23:30 in Buenos Aires (UTC-3) is 2026-11-01T02:30Z.
    expect(currentMonthStart(new Date('2026-11-01T02:30:00Z'), BA)).toBe('2026-10-01');
  });

  it('gives October at 2026-11-01T01:00Z', () => {
    expect(currentMonthStart(new Date('2026-11-01T01:00:00Z'), BA)).toBe('2026-10-01');
  });

  it('rolls over once the zone reaches the next month', () => {
    expect(currentMonthStart(new Date('2026-11-01T03:00:00Z'), BA)).toBe('2026-11-01');
  });

  it('returns the first day of a mid-month instant', () => {
    expect(currentMonthStart(new Date('2026-10-15T12:00:00Z'), BA)).toBe('2026-10-01');
  });
});

describe('versionInForce (AC-12)', () => {
  const september = version('2026-09-01', { amount: 10000000n });
  const october = version('2026-10-01', { amount: 20000000n });

  it('picks September for a September month and October for October', () => {
    expect(versionInForce([october, september], '2026-09-01')).toBe(september);
    expect(versionInForce([september, october], '2026-10-01')).toBe(october);
  });

  it('picks the greatest effective_from not after the month', () => {
    expect(versionInForce([september, october], '2026-12-01')).toBe(october);
  });

  it('returns null when every version is later than the month', () => {
    expect(versionInForce([october], '2026-09-01')).toBeNull();
    expect(versionInForce([], '2026-09-01')).toBeNull();
  });
});

describe('mergeVersion (D2)', () => {
  it('copies unspecified fields from the current version and takes the new month', () => {
    const merged = mergeVersion(version('2026-09-01'), { amount: 20000000n }, '2026-10-01');
    expect(merged).toEqual(version('2026-10-01', { amount: 20000000n }));
  });

  it('applies every change and does not mutate the current version', () => {
    const current = version('2026-09-01');
    const merged = mergeVersion(
      current,
      { name: 'Food', rollover: true, categoryIds: [CAT_B], thresholds: [50] },
      '2026-10-01',
    );
    expect(merged).toEqual({
      effectiveFrom: '2026-10-01',
      name: 'Food',
      amount: 15000000n,
      rollover: true,
      categoryIds: [CAT_B],
      thresholds: [50],
    });
    expect(current).toEqual(version('2026-09-01'));
  });

  it('keeps an explicit false rollover', () => {
    const current = version('2026-09-01', { rollover: true });
    expect(mergeVersion(current, { rollover: false }, '2026-10-01').rollover).toBe(false);
  });
});

describe('typed errors map to HTTP (AC-04, AC-23)', () => {
  async function answerTo(error: AppError) {
    const app = express();
    app.get('/x', () => {
      throw error;
    });
    app.use(createErrorHandler(createLogger({ level: 'silent' })));
    const response = await request(app).get('/x');
    return { status: response.status, code: (response.body as { code: string }).code };
  }

  it('maps BUDGET_LIMIT_REACHED to 409', async () => {
    expect(await answerTo(new BudgetLimitReached())).toEqual({
      status: 409,
      code: 'BUDGET_LIMIT_REACHED',
    });
  });

  it('maps BUDGET_CATEGORY_KIND_INVALID to 400', async () => {
    expect(await answerTo(new BudgetCategoryKindInvalid())).toEqual({
      status: 400,
      code: 'BUDGET_CATEGORY_KIND_INVALID',
    });
  });
});

describe('module boundaries', () => {
  it('domain and application import nothing from infrastructure', () => {
    const root = join(__dirname, '../../src/budgets');
    for (const layer of ['domain', 'application']) {
      const files = readdirSync(join(root, layer), { recursive: true, encoding: 'utf8' }).filter(
        (f) => f.endsWith('.ts'),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const text = readFileSync(join(root, layer, file), 'utf8');
        expect(text, `${layer}/${file}`).not.toMatch(/from\s+['"][^'"]*infrastructure/);
        expect(text, `${layer}/${file}`).not.toMatch(/from\s+['"]drizzle-orm/);
      }
    }
  });
});
