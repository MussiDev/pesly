import { describe, expect, it } from 'vitest';
import {
  datesOfPeriod,
  planInstallments,
  previewInstallmentSchedule,
} from '../src/credit-cards/installment-schedule';
import { assignStatement } from '../src/credit-cards/statement-assignment';

const card = { closingDay: 24, dueDay: 5 };

function statement(period: string, closingDate: string, dueDate: string) {
  return { period, closingDate, dueDate };
}

describe('planInstallments', () => {
  it('splits 100.00 in 3 as 33.34, 33.33, 33.33 on consecutive periods (AC-03)', () => {
    expect(planInstallments(10000n, 3, '2026-11')).toEqual([
      { number: 1, period: '2026-11', amount: 3334n },
      { number: 2, period: '2026-12', amount: 3333n },
      { number: 3, period: '2027-01', amount: 3333n },
    ]);
  });

  it('adds up to the total for a range of totals and counts (AC-03)', () => {
    for (const total of [60n, 61n, 99n, 10000n, 123457n, 9007199254740993n]) {
      for (const count of [2, 3, 7, 12, 59, 60]) {
        const sum = planInstallments(total, count, '2026-01').reduce(
          (acc, p) => acc + p.amount,
          0n,
        );
        expect(sum).toBe(total);
      }
    }
  });
});

describe('assignStatement', () => {
  const statements = [
    { id: 'a', closingDate: '2026-10-24' },
    { id: 'b', closingDate: '2026-11-24' },
  ];

  it('gives a purchase on the closing day that statement and the next day the next one (AC-04)', () => {
    expect(assignStatement('2026-10-24', statements)?.id).toBe('a');
    expect(assignStatement('2026-10-25', statements)?.id).toBe('b');
  });
});

describe('datesOfPeriod', () => {
  it('uses the stored dates for a stored period and the default cycle otherwise (AC-09)', () => {
    const stored = [statement('2026-10', '2026-10-20', '2026-11-02')];
    expect(datesOfPeriod('2026-10', stored, card)).toEqual({
      closingDate: '2026-10-20',
      dueDate: '2026-11-02',
    });
    expect(datesOfPeriod('2026-11', stored, card)).toEqual({
      closingDate: '2026-11-24',
      dueDate: '2026-12-05',
    });
  });
});

describe('previewInstallmentSchedule', () => {
  const stored = [
    statement('2026-10', '2026-10-24', '2026-11-05'),
    statement('2026-11', '2026-11-24', '2026-12-05'),
  ];
  const base = { total: 10000n, count: 3, today: '2026-10-10', card };

  it('assigns a purchase on the closing day to that statement and the next day to the next (AC-04)', () => {
    const onClosing = previewInstallmentSchedule({
      ...base,
      purchasedOn: '2026-10-24',
      statements: stored,
    });
    const after = previewInstallmentSchedule({
      ...base,
      purchasedOn: '2026-10-25',
      statements: stored,
    });
    expect(onClosing.rows.map((r) => r.period)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(after.rows.map((r) => r.period)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('gives the same result with statements sorted newest first or oldest first (AC-04)', () => {
    // An early day, so an unsorted newest-first list would pick a later statement.
    const input = { ...base, purchasedOn: '2026-10-01' };
    const oldestFirst = previewInstallmentSchedule({ ...input, statements: stored });
    const newestFirst = previewInstallmentSchedule({ ...input, statements: [...stored].reverse() });
    expect(newestFirst).toEqual(oldestFirst);
    expect(newestFirst.rows[0]?.period).toBe('2026-10');
  });

  it('uses the last stored statement when none closes on or after the day', () => {
    const result = previewInstallmentSchedule({
      ...base,
      purchasedOn: '2027-03-01',
      statements: [...stored].reverse(),
    });
    expect(result.rows[0]?.period).toBe('2026-11');
  });

  it('falls back to the first open period when there are no statements', () => {
    const result = previewInstallmentSchedule({
      ...base,
      purchasedOn: '2026-10-25',
      statements: [],
    });
    expect(result.rows.map((r) => r.period)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(result.rows[0]).toMatchObject({ closingDate: '2026-11-24', dueDate: '2026-12-05' });
  });

  it('uses edited dates for a stored period and default dates for one not stored (AC-09)', () => {
    const result = previewInstallmentSchedule({
      ...base,
      purchasedOn: '2026-10-01',
      statements: [statement('2026-10', '2026-10-20', '2026-11-02')],
    });
    expect(result.rows[0]).toMatchObject({ closingDate: '2026-10-20', dueDate: '2026-11-02' });
    expect(result.rows[1]).toMatchObject({ closingDate: '2026-11-24', dueDate: '2026-12-05' });
  });

  it('gives one row with the full amount and kind expense for one payment (AC-07)', () => {
    const result = previewInstallmentSchedule({
      ...base,
      count: 1,
      purchasedOn: '2026-10-01',
      statements: stored,
    });
    expect(result.kind).toBe('expense');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ number: 1, amount: 10000n, period: '2026-10' });
  });

  it('gives kind installments for two or more payments, adding up to the total (AC-07)', () => {
    const result = previewInstallmentSchedule({
      ...base,
      count: 2,
      purchasedOn: '2026-10-01',
      statements: stored,
    });
    expect(result.kind).toBe('installments');
    expect(result.rows.map((r) => r.amount)).toEqual([5000n, 5000n]);
  });

  it('sets firstClosed when the first statement closed before today (AC-06)', () => {
    const closed = previewInstallmentSchedule({
      ...base,
      today: '2026-10-25',
      purchasedOn: '2026-10-01',
      statements: stored,
    });
    expect(closed.firstClosed).toBe(true);
    expect(closed.firstClosingDate).toBe('2026-10-24');
    expect(closed.rows[0]?.closed).toBe(true);
    expect(closed.rows[1]?.closed).toBe(false);

    const open = previewInstallmentSchedule({
      ...base,
      today: '2026-10-24',
      purchasedOn: '2026-10-01',
      statements: stored,
    });
    expect(open.firstClosed).toBe(false);
  });

  it('keeps a USD purchase amounts as given with no conversion field (AC-10)', () => {
    const result = previewInstallmentSchedule({
      ...base,
      total: 30001n,
      purchasedOn: '2026-10-01',
      statements: stored,
    });
    expect(result.rows.map((r) => r.amount)).toEqual([10001n, 10000n, 10000n]);
    expect(Object.keys(result).sort()).toEqual(['firstClosed', 'firstClosingDate', 'kind', 'rows']);
    expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual([
      'amount',
      'closed',
      'closingDate',
      'dueDate',
      'number',
      'period',
    ]);
  });

  it('throws RangeError for a count of 0 or 61 and for a total smaller than the count (AC-13)', () => {
    const input = { ...base, purchasedOn: '2026-10-01', statements: stored };
    expect(() => previewInstallmentSchedule({ ...input, count: 0 })).toThrow(RangeError);
    expect(() => previewInstallmentSchedule({ ...input, count: 61 })).toThrow(RangeError);
    expect(() => previewInstallmentSchedule({ ...input, count: 5, total: 4n })).toThrow(RangeError);
  });

  it('throws RangeError for an invalid date string (AC-13)', () => {
    expect(() =>
      previewInstallmentSchedule({ ...base, purchasedOn: '2026-13-45', statements: [] }),
    ).toThrow(RangeError);
  });
});
