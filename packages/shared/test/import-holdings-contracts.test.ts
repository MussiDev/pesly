import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_HOLDINGS } from '../src/investments/constants';
import {
  importHoldingsRequestSchema,
  importHoldingsResponseSchema,
} from '../src/investments/contracts';

const ROW = {
  ticker: 'IBIT',
  instrumentName: 'CEDEAR ISHARES BITCOIN TR (IBIT)',
  instrumentType: 'cedear',
  valuationCurrency: 'ARS',
  quantity: '4600000000',
  totalCost: '41949600',
  unitPrice: '753500',
  pricedOn: '2026-10-09',
};
const request = (holdings: unknown[]) => ({ holdings });
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ ...ROW, ticker: `T${index}` }));

describe('importHoldingsRequestSchema (DISC-001-07c FR-01, FR-04)', () => {
  it('accepts one row and the 1,000-row limit', () => {
    expect(importHoldingsRequestSchema.safeParse(request([ROW])).success).toBe(true);
    expect(IMPORT_MAX_HOLDINGS).toBe(1000);
    expect(importHoldingsRequestSchema.safeParse(request(rows(1000))).success).toBe(true);
  });

  it('accepts a null total cost and a USD currency (AC-03, AC-09)', () => {
    const parsed = importHoldingsRequestSchema.safeParse(
      request([{ ...ROW, totalCost: null, valuationCurrency: 'USD' }]),
    );

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['no rows', request([])],
    ['1,001 rows', request(rows(1001))],
    ['crypto', request([{ ...ROW, instrumentType: 'crypto' }])],
    ['an unknown type', request([{ ...ROW, instrumentType: 'warrant' }])],
    ['a decimal quantity', request([{ ...ROW, quantity: '12.5' }])],
    ['a zero price', request([{ ...ROW, unitPrice: '0' }])],
    ['a zero cost', request([{ ...ROW, totalCost: '0' }])],
    ['a missing currency', request([{ ...ROW, valuationCurrency: undefined }])],
    ['a bad currency', request([{ ...ROW, valuationCurrency: 'EUR' }])],
    ['a non-calendar day', request([{ ...ROW, pricedOn: '2026-02-30' }])],
    ['a day with a time', request([{ ...ROW, pricedOn: '2026-10-09T00:00:00Z' }])],
    ['a bad ticker', request([{ ...ROW, ticker: '<script>' }])],
    ['a missing body', {}],
  ])('rejects %s (AC-05)', (_label, body) => {
    expect(importHoldingsRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('importHoldingsResponseSchema', () => {
  it('requires the three counts', () => {
    expect(
      importHoldingsResponseSchema.safeParse({ created: 1, updated: 0, removed: 0 }).success,
    ).toBe(false);
  });
});
