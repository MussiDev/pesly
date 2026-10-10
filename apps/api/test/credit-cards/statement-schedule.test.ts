import { describe, expect, it } from 'vitest';
import { linkedAccountNames, type Statement } from '../../src/credit-cards/domain/credit-card';
import { CardDaysConflict, StatementDatesInvalid } from '../../src/credit-cards/domain/errors';
import {
  MAX_GENERATED_CYCLES,
  missingStatements,
  recomputeOpenStatements,
  validateStatementDates,
} from '../../src/credit-cards/domain/statement-schedule';

const statement = (period: string, closingDate: string, dueDate: string): Statement => ({
  id: `s-${period}`,
  cardId: 'card',
  period,
  closingDate,
  dueDate,
});

describe('linkedAccountNames', () => {
  it('names the two linked accounts after the card (FR-02)', () => {
    expect(linkedAccountNames('Visa')).toEqual({ ARS: 'Visa ARS', USD: 'Visa USD' });
  });
});

describe('missingStatements', () => {
  const days = { closingDay: 24, dueDay: 5 };

  it('creates nothing while the latest statement is open', () => {
    expect(
      missingStatements(statement('2026-10', '2026-10-24', '2026-11-05'), days, '2026-10-24'),
    ).toEqual([]);
  });

  it('creates every cycle after the latest until one is open (FR-03)', () => {
    expect(
      missingStatements(statement('2026-10', '2026-10-24', '2026-11-05'), days, '2027-01-10'),
    ).toEqual([
      { period: '2026-11', closingDate: '2026-11-24', dueDate: '2026-12-05' },
      { period: '2026-12', closingDate: '2026-12-24', dueDate: '2027-01-05' },
      { period: '2027-01', closingDate: '2027-01-24', dueDate: '2027-02-05' },
    ]);
  });

  it('skips a cycle whose closing date is not after the latest one (error path)', () => {
    // The October statement was moved by hand to 2026-11-24, as late as the November default.
    expect(
      missingStatements(statement('2026-10', '2026-11-24', '2026-12-01'), days, '2026-11-25'),
    ).toEqual([{ period: '2026-12', closingDate: '2026-12-24', dueDate: '2027-01-05' }]);
  });

  it('stops at the guard after the maximum number of cycles (error path)', () => {
    const drafts = missingStatements(
      statement('1900-01', '1900-01-24', '1900-02-05'),
      days,
      '2200-01-01',
    );
    expect(drafts).toHaveLength(MAX_GENERATED_CYCLES);
  });
});

describe('recomputeOpenStatements', () => {
  const closed = statement('2026-09', '2026-09-24', '2026-10-05');
  const open = statement('2026-10', '2026-10-26', '2026-11-05');

  it('rewrites open statements with the new days, hand edits included, and leaves closed ones (AC-08)', () => {
    expect(
      recomputeOpenStatements([closed, open], { closingDay: 20, dueDay: 5 }, '2026-10-10'),
    ).toEqual([{ ...open, closingDate: '2026-10-20', dueDate: '2026-11-05' }]);
  });

  it('refuses days that close an open statement on or before the previous one (sad path)', () => {
    const lateClosed = statement('2026-09', '2026-10-02', '2026-10-15');
    expect(() =>
      recomputeOpenStatements([lateClosed, open], { closingDay: 1, dueDay: 10 }, '2026-10-10'),
    ).toThrow(CardDaysConflict);
  });

  it('returns nothing when every statement is closed', () => {
    expect(recomputeOpenStatements([closed], { closingDay: 20, dueDay: 5 }, '2026-10-10')).toEqual(
      [],
    );
  });
});

describe('validateStatementDates', () => {
  it('accepts dates between the previous closing date and the next cycle (AC-06)', () => {
    expect(() => {
      validateStatementDates(
        { closingDate: '2026-10-26', dueDate: '2026-11-05' },
        '2026-09-24',
        '2026-11-24',
      );
    }).not.toThrow();
    expect(() => {
      validateStatementDates(
        { closingDate: '2026-10-26', dueDate: '2026-11-05' },
        null,
        '2026-11-24',
      );
    }).not.toThrow();
  });

  it.each([
    ['on the previous closing date', '2026-09-24', '2026-10-05', 'body.closingDate'],
    ['at the next cycle closing date', '2026-11-24', '2026-12-05', 'body.closingDate'],
    ['with the due date on the closing date', '2026-10-26', '2026-10-26', 'body.dueDate'],
  ])(
    'refuses a closing date %s as invalid input (sad path)',
    (_label, closingDate, dueDate, field) => {
      try {
        validateStatementDates({ closingDate, dueDate }, '2026-09-24', '2026-11-24');
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(StatementDatesInvalid);
        expect((error as StatementDatesInvalid).fields).toEqual([field]);
      }
    },
  );
});
