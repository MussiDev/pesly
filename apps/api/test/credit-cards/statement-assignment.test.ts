import { describe, expect, it } from 'vitest';
import {
  assignStatement,
  statementTotals,
  type DailyPurchase,
} from '../../src/credit-cards/domain/statement-assignment';

const statements = [
  { id: 'sep', closingDate: '2026-09-24' },
  { id: 'oct', closingDate: '2026-10-24' },
  { id: 'nov', closingDate: '2026-11-24' },
];

describe('assignStatement', () => {
  it('assigns the closing day itself to the statement closing that day (AC-02)', () => {
    expect(assignStatement('2026-10-24', statements)?.id).toBe('oct');
  });

  it('assigns the day after a closing date to the next statement (AC-03)', () => {
    expect(assignStatement('2026-10-25', statements)?.id).toBe('nov');
  });

  it('assigns a day before every stored cycle to the first statement (AC-03)', () => {
    expect(assignStatement('2026-01-01', statements)?.id).toBe('sep');
  });

  it('moving a closing date reassigns by construction (AC-04)', () => {
    const moved = [
      { id: 'sep', closingDate: '2026-09-24' },
      { id: 'oct', closingDate: '2026-10-26' },
      { id: 'nov', closingDate: '2026-11-24' },
    ];
    expect(assignStatement('2026-10-25', moved)?.id).toBe('oct');
    expect(assignStatement('2026-10-26', moved)?.id).toBe('oct');
    expect(assignStatement('2026-10-27', moved)?.id).toBe('nov');
  });

  it('assigns no statement to a day after the last closing date (error path)', () => {
    expect(assignStatement('2026-11-25', statements)).toBeUndefined();
  });

  it('assigns nothing when there are no statements (error path)', () => {
    const none: typeof statements = [];
    expect(assignStatement('2026-10-01', none)).toBeUndefined();
  });
});

describe('statementTotals', () => {
  const purchases: DailyPurchase[] = [
    { day: '2026-10-10', currency: 'ARS', amount: 3000000n },
    { day: '2026-10-24', currency: 'ARS', amount: 2000000n },
    { day: '2026-10-24', currency: 'USD', amount: 2000n },
  ];

  it('sums per statement and currency, with zeros for a statement without purchases (AC-05)', () => {
    const totals = statementTotals(statements, purchases);
    expect(totals.get('oct')).toEqual({ ARS: 5000000n, USD: 2000n });
    expect(totals.get('sep')).toEqual({ ARS: 0n, USD: 0n });
    expect(totals.get('nov')).toEqual({ ARS: 0n, USD: 0n });
  });

  it('ignores days after the last closing date (error path)', () => {
    const totals = statementTotals(statements, [
      ...purchases,
      { day: '2026-12-01', currency: 'USD', amount: 99n },
    ]);
    expect(totals.get('nov')).toEqual({ ARS: 0n, USD: 0n });
    expect(totals.get('oct')).toEqual({ ARS: 5000000n, USD: 2000n });
  });

  it('adds amounts above 2^53 exactly (NFR-01)', () => {
    const big = 9007199254740993n;
    const totals = statementTotals(statements, [
      { day: '2026-10-01', currency: 'ARS', amount: big },
      { day: '2026-10-02', currency: 'ARS', amount: 1n },
    ]);
    expect(totals.get('oct')?.ARS).toBe(big + 1n);
  });
});
