import { describe, expect, it } from 'vitest';
import {
  hasEntityFilter,
  parseReportFilters,
  serializeReportFilters,
  toReportQuery,
} from '../src/features/reports/report-filters-state';

const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const params = (query: string) => new URLSearchParams(query);

describe('parseReportFilters (FR-14)', () => {
  it('?tag=vacations2026&from=2026-01-01 applies both (AC-30)', () => {
    expect(parseReportFilters(params('tag=vacations2026&from=2026-01-01'), 'categories')).toEqual({
      tag: 'vacations2026',
      from: '2026-01-01',
    });
  });

  it('from=31-12-2026 is ignored and the other filters stay (AC-31)', () => {
    expect(
      parseReportFilters(params(`from=31-12-2026&to=2026-02-01&accountId=${ID}`), 'incomeExpenses'),
    ).toEqual({ to: '2026-02-01', accountId: ID });
  });

  it('error: a non-UUID account, an over-long tag and an impossible day are ignored', () => {
    expect(parseReportFilters(params('accountId=not-a-uuid'), 'categories')).toEqual({});
    expect(parseReportFilters(params(`tag=${'a'.repeat(31)}`), 'categories')).toEqual({});
    expect(parseReportFilters(params('from=2026-02-31'), 'categories')).toEqual({});
  });

  it('error: a repeated key is ignored', () => {
    expect(parseReportFilters(params('tag=a&tag=b&from=2026-01-01'), 'categories')).toEqual({
      from: '2026-01-01',
    });
  });

  it('net worth never reads accountId or tag', () => {
    expect(
      parseReportFilters(params(`accountId=${ID}&tag=trip&from=2026-01-01`), 'netWorth'),
    ).toEqual({ from: '2026-01-01' });
  });

  it('unknown keys are ignored', () => {
    expect(parseReportFilters(params('foo=bar'), 'categories')).toEqual({});
  });
});

describe('serialize and query', () => {
  it('writes the keys in a fixed order and skips the absent ones', () => {
    const text = serializeReportFilters({
      tag: 'trip',
      from: '2026-01-01',
      accountId: ID,
    }).toString();
    expect(text).toBe(`from=2026-01-01&accountId=${ID}&tag=trip`);
    expect(serializeReportFilters({}).toString()).toBe('');
  });

  it('round trips through the address', () => {
    const filters = { from: '2026-01-01', to: '2026-02-01', tag: 'trip' };
    expect(parseReportFilters(serializeReportFilters(filters), 'categories')).toEqual(filters);
  });

  it('hasEntityFilter is true only for an account or a tag', () => {
    expect(hasEntityFilter({ from: '2026-01-01' })).toBe(false);
    expect(hasEntityFilter({ accountId: ID })).toBe(true);
    expect(hasEntityFilter({ tag: 'trip' })).toBe(true);
  });

  it('toReportQuery carries only the defined keys', () => {
    expect(toReportQuery({ from: '2026-01-01', tag: undefined })).toEqual({ from: '2026-01-01' });
    expect(Object.keys(toReportQuery({}))).toEqual([]);
  });
});
