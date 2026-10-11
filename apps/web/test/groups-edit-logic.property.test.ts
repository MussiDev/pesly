import { MOVEMENT_AMOUNT_MAX_MINOR_UNITS } from '@pesly/shared';
import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import {
  buildExpenseEditRequest,
  expenseEditValues,
} from '../src/features/groups/edit/expense-edit-values';
import { buildSettlementEditRequest } from '../src/features/groups/edit/settlement-edit-request';

const CASES = 1_000;

// Seeded generator so a failure reproduces; no dependency is added for this.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261012);
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));

function randomMinor(): bigint {
  const digits = int(3, 14);
  let text = String(int(1, 9));
  for (let i = 1; i < digits; i += 1) text += String(int(0, 9));
  const value = BigInt(text);
  return value > MOVEMENT_AMOUNT_MAX_MINOR_UNITS ? MOVEMENT_AMOUNT_MAX_MINOR_UNITS : value;
}

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CATEGORY = '44444444-4444-4444-8444-444444444444';
const TZ = 'America/Argentina/Buenos_Aires';
const NOW = new Date('2026-10-11T15:00:00.000Z');

const expense = {
  id: '55555555-5555-4555-8555-555555555555',
  groupId: '99999999-9999-4999-8999-999999999999',
  payerMemberId: ANA,
  createdByMemberId: ANA,
  amount: '100',
  currency: 'ARS',
  occurredAt: '2026-10-11T13:00:00.000Z',
  categoryId: CATEGORY,
  description: 'Groceries',
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: '2026-10-11T13:00:00.000Z',
  shares: [
    { memberId: ANA, amount: '50' },
    { memberId: BRUNO, amount: '50' },
  ],
  version: 1,
} as GroupExpenseResponse;

const settlement = {
  id: '66666666-6666-4666-8666-666666666666',
  groupId: expense.groupId,
  fromMemberId: ANA,
  toMemberId: BRUNO,
  currency: 'ARS',
  amount: '1',
  legs: [{ currency: 'ARS', amount: '1' }],
  occurredAt: '2026-10-11T13:00:00.000Z',
  createdByMemberId: ANA,
  accountId: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-11T13:00:00.000Z',
  version: 1,
} as SettlementResponse;

function typed(minor: bigint, locale: 'en' | 'es'): string {
  const whole = (minor / 100n).toString();
  const cents = (minor % 100n).toString().padStart(2, '0');
  return `${whole}${locale === 'es' ? ',' : '.'}${cents}`;
}

describe('amounts typed as locale text reach the request exactly (NFR-04)', () => {
  it.each(['en', 'es'] as const)('expense edit, %s', (locale) => {
    const context = {
      members: [{ id: ANA }, { id: BRUNO }],
      groupCategories: [{ id: CATEGORY, archivedAt: null }],
      timeZone: TZ,
      locale,
      now: NOW,
    };
    const base = expenseEditValues(expense, undefined, context);
    for (let i = 0; i < CASES; i += 1) {
      const minor = randomMinor();
      const result = buildExpenseEditRequest({ ...base, amount: typed(minor, locale) }, context);
      expect(result.request?.amount).toBe(minor.toString());
    }
  });

  it.each(['en', 'es'] as const)('settlement edit, %s', (locale) => {
    for (let i = 0; i < CASES; i += 1) {
      const minor = randomMinor();
      const result = buildSettlementEditRequest(
        { amount: typed(minor, locale), occurredAt: '2026-10-11T10:00' },
        settlement,
        { timeZone: TZ, locale, now: NOW },
      );
      expect(result.request?.amount).toBe(minor.toString());
    }
  });
});
