import { describe, expect, it } from 'vitest';
import { MOVEMENT_TYPES, listMovementsQuerySchema, movementFilterShape } from '../src';

const UUID = '0b9d1f6e-5a3c-4c8e-9a43-2f1d7a6b8c90';
const OTHER_UUID = '5d7c2b1a-9e84-4f3a-8b61-0c2d4e6f8a10';

describe('movement list filters', () => {
  it('exposes the filter shape', () => {
    expect(Object.keys(movementFilterShape).sort()).toEqual(
      ['accountId', 'categoryId', 'from', 'tag', 'to', 'type'].sort(),
    );
  });

  it('accepts each filter alone and all together (AC-01)', () => {
    const singles = [
      { accountId: UUID },
      { categoryId: UUID },
      { type: 'income' },
      { tag: 'Viaje' },
      { from: '2026-10-01' },
      { to: '2026-10-31' },
    ];
    for (const query of singles) {
      expect(listMovementsQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(true);
    }
    const all = listMovementsQuerySchema.parse({
      accountId: UUID,
      categoryId: OTHER_UUID,
      type: 'expense',
      tag: ' Viaje ',
      from: '2026-10-01',
      to: '2026-10-31',
      limit: '20',
      offset: '5',
    });
    expect(all).toEqual({
      accountId: UUID,
      categoryId: OTHER_UUID,
      type: 'expense',
      tag: 'Viaje',
      from: '2026-10-01',
      to: '2026-10-31',
      limit: 20,
      offset: 5,
    });
  });

  it('still defaults to limit 50 and rejects 101 (AC-01)', () => {
    expect(listMovementsQuerySchema.parse({ tag: 'a' })).toEqual({
      tag: 'a',
      limit: 50,
      offset: 0,
    });
    expect(listMovementsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('accepts equal from and to and the range edges', () => {
    const ok = (query: object) => listMovementsQuerySchema.safeParse(query).success;
    expect(ok({ from: '2026-10-01', to: '2026-10-01' })).toBe(true);
    expect(ok({ from: '1970-01-01', to: '2100-12-31' })).toBe(true);
    expect(ok({ from: '2024-02-29' })).toBe(true);
  });

  it('rejects impossible, out of range and malformed dates (AC-01)', () => {
    const dates = [
      '2026-02-30',
      '2025-02-29',
      '2026-13-01',
      '2026-00-10',
      '1969-12-31',
      '2101-01-01',
      '2026-1-1',
      '2026-10-01T00:00:00Z',
      '',
      ' ',
    ];
    for (const date of dates) {
      expect(listMovementsQuerySchema.safeParse({ from: date }).success, `from ${date}`).toBe(
        false,
      );
      expect(listMovementsQuerySchema.safeParse({ to: date }).success, `to ${date}`).toBe(false);
    }
  });

  it('rejects a from later than the to, naming the field path (AC-01)', () => {
    const result = listMovementsQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('from');
  });

  it('rejects a malformed UUID, an unknown type and a bad tag (AC-01)', () => {
    const queries = [
      { accountId: 'nope' },
      { categoryId: 'nope' },
      { type: 'refund' },
      { tag: '' },
      { tag: 'a'.repeat(31) },
      { tag: 'a\u0000' },
    ];
    for (const query of queries) {
      expect(listMovementsQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('strips unknown keys', () => {
    expect(listMovementsQuerySchema.parse({ ownerId: 'x' })).not.toHaveProperty('ownerId');
  });

  it('probe: the type filter accepts every movement type that exists (AC-01)', () => {
    for (const type of MOVEMENT_TYPES) {
      expect(listMovementsQuerySchema.safeParse({ type }).success, type).toBe(true);
    }
  });
});
