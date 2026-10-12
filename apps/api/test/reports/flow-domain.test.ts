import { describe, expect, it } from 'vitest';
import { convertAmount, effectiveNames, namesMatch } from '../../src/reports/domain/conversion';
import {
  convertRows,
  installmentDueDate,
  installmentMonthOf,
  matchShareCategory,
  type TopCategory,
} from '../../src/reports/domain/flows';

const category = (fields: Partial<TopCategory> & { id: string }): TopCategory => ({
  name: null,
  defaultKey: null,
  children: [],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...fields,
});

describe('convertAmount', () => {
  it('converts 20.00 USD at a frozen 1,400.0000 to 28,000.00 ARS (AC-15)', () => {
    expect(convertAmount(2000n, 'USD', 'ARS', 14000000n)).toBe(2800000n);
  });

  it('converts 30,000.00 ARS at a frozen 1,500.0000 to 20.00 USD (AC-17)', () => {
    expect(convertAmount(3000000n, 'ARS', 'USD', 15000000n)).toBe(2000n);
  });

  it('leaves the same currency unchanged whatever the rate and gives null with no rate', () => {
    expect(convertAmount(500n, 'ARS', 'ARS', null)).toBe(500n);
    expect(convertAmount(500n, 'USD', 'ARS', null)).toBeNull();
  });

  it('refuses a currency that is neither ARS nor USD', () => {
    expect(() => convertAmount(1n, 'EUR' as never, 'ARS', 14000000n)).toThrow(RangeError);
    expect(() => convertAmount(1n, 'ARS', 'EUR' as never, 14000000n)).toThrow(RangeError);
  });
});

describe('effectiveNames and namesMatch', () => {
  it('answers to the custom name alone once set, otherwise both default names', () => {
    expect(effectiveNames({ name: 'Super', defaultKey: 'food' })).toEqual(['Super']);
    expect(effectiveNames({ name: null, defaultKey: null })).toEqual([]);
    expect(effectiveNames({ name: null, defaultKey: 'food' }).length).toBe(2);
  });

  it('compares names case-insensitively and in NFC', () => {
    expect(namesMatch('CAFÉ', 'café')).toBe(true);
    expect(namesMatch('a', 'b')).toBe(false);
  });
});

describe('convertRows', () => {
  it('converts each row once and keeps the row beside its amount', () => {
    const rows = [
      { currency: 'USD' as const, rate: 14000000n, sum: 2000n, count: 1 },
      { currency: 'ARS' as const, rate: 14000000n, sum: 100n, count: 2 },
    ];

    const result = convertRows(rows, 'ARS', 'throw');

    expect(result.items.map((item) => item.amount)).toEqual([2800000n, 100n]);
    expect(result.items[0]?.row).toBe(rows[0]);
    expect(result.unconvertedCount).toBe(0);
  });

  it('leaves out a share in USD with no frozen rate and counts its shares, not its rows (AC-21)', () => {
    const rows = [
      { currency: 'USD' as const, rate: null, sum: 3000n, count: 3 },
      { currency: 'ARS' as const, rate: null, sum: 100n, count: 1 },
    ];

    const result = convertRows(rows, 'ARS', 'count');

    expect(result.items.map((item) => item.amount)).toEqual([100n]);
    expect(result.unconvertedCount).toBe(3);
  });

  it('throws for a personal row that needs a frozen rate and has none (FR-06)', () => {
    const rows = [{ currency: 'USD' as const, rate: null, sum: 1n, count: 1 }];

    expect(() => convertRows(rows, 'ARS', 'throw')).toThrow(RangeError);
  });

  it('throws for a row in an unknown currency', () => {
    const rows = [{ currency: 'EUR' as never, rate: 1n, sum: 1n, count: 1 }];

    expect(() => convertRows(rows, 'ARS', 'count')).toThrow(RangeError);
  });
});

describe('matchShareCategory', () => {
  const food = category({ id: 'food', name: 'Food' });

  it('matches the personal category by the effective name, case-insensitively (AC-18)', () => {
    expect(matchShareCategory({ name: 'FOOD', defaultKey: null }, [food])).toBe('food');
  });

  it('adds the share to the personal rows of the category: 50,000.00 + 10,000.00 = 60,000.00 (AC-18)', () => {
    const personal = convertRows(
      [{ currency: 'ARS' as const, rate: 14000000n, sum: 5000000n, count: 1 }],
      'ARS',
      'throw',
    );
    const shares = convertRows(
      [{ currency: 'ARS' as const, rate: null, sum: 1000000n, count: 1 }],
      'ARS',
      'count',
    );
    const matched = matchShareCategory({ name: 'food', defaultKey: null }, [food]);

    const total = [...personal.items, ...(matched === 'food' ? shares.items : [])].reduce(
      (sum, item) => sum + item.amount,
      0n,
    );

    expect(total).toBe(6000000n);
  });

  it('matches through the names of a child category', () => {
    const withChild = category({
      id: 'home',
      name: 'Home',
      children: [{ name: 'Rent', defaultKey: null }],
    });

    expect(matchShareCategory({ name: 'rent', defaultKey: null }, [food, withChild])).toBe('home');
  });

  it('matches a default category by either language name', () => {
    const defaults = category({ id: 'd', defaultKey: 'food' });
    const [es, en] = effectiveNames({ name: null, defaultKey: 'food' });

    expect(matchShareCategory({ name: es ?? '', defaultKey: null }, [defaults])).toBe('d');
    expect(matchShareCategory({ name: en ?? '', defaultKey: null }, [defaults])).toBe('d');
    expect(matchShareCategory({ name: null, defaultKey: 'food' }, [defaults])).toBe('d');
  });

  it('gives null when nothing matches (AC-20)', () => {
    expect(matchShareCategory({ name: 'Trips', defaultKey: null }, [food])).toBeNull();
    expect(matchShareCategory({ name: null, defaultKey: null }, [food])).toBeNull();
  });

  it('breaks a tie with the earliest created category, whatever the input order', () => {
    const later = category({
      id: 'later',
      name: 'Food',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const earlier = category({
      id: 'earlier',
      name: 'food',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });

    expect(matchShareCategory({ name: 'Food', defaultKey: null }, [later, earlier])).toBe(
      'earlier',
    );
  });
});

describe('installmentDueDate and installmentMonthOf', () => {
  it('uses the stored due date of the statement (AC-23)', () => {
    expect(
      installmentDueDate({ period: '2026-10', dueDate: '2026-11-10', closingDay: 25, dueDay: 10 }),
    ).toBe('2026-11-10');
  });

  it('derives the due date from the card days when no statement is stored (AC-23)', () => {
    expect(
      installmentDueDate({ period: '2026-10', dueDate: null, closingDay: 25, dueDay: 10 }),
    ).toBe('2026-11-10');
  });

  it('names the month of the due date only when it is inside the range', () => {
    const row = { period: '2026-10', dueDate: '2026-11-10', closingDay: 25, dueDay: 10 };

    expect(installmentMonthOf(row, '2026-11-01', '2026-11-30')).toBe('2026-11');
    expect(installmentMonthOf(row, '2026-11-11', '2026-11-30')).toBeNull();
    expect(installmentMonthOf(row, '2026-10-01', '2026-11-09')).toBeNull();
    expect(installmentMonthOf(row, '2026-11-10', '2026-11-10')).toBe('2026-11');
  });
});
