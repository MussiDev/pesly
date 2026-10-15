import {
  nextPeriod,
  previewInstallmentSchedule,
  type InstallmentSchedule,
  type PreviewInstallmentScheduleInput,
} from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { CreateCreditCard } from '../../src/credit-cards/application/create-credit-card';
import { CreateInstallmentPurchase } from '../../src/credit-cards/application/create-installment-purchase';
import { ListStatements } from '../../src/credit-cards/application/list-statements';
import { RecordCardExpense } from '../../src/credit-cards/application/record-card-expense';
import {
  FakeActivity,
  FakeCardPurchases,
  FakeClock,
  FakeExpenseRecorder,
  FakeTimeZones,
  InMemoryCreditCards,
  installmentFakes,
  writeScopeFor,
} from './fakes';

// The preview the web shows and the use cases the API runs must agree for every input the form can
// send (FEAT-013 AC-11). The sweep is a fixed grid, bigint only, with no random generator.

type Preview = (input: PreviewInstallmentScheduleInput) => InstallmentSchedule;

const ANA = 'ana';
const CATEGORY = '7c1d6c6e-7f0e-4d57-9a53-6a1b5d7d1a11';
const CARD_CREATED_AT = '2026-07-10T20:00:00.000Z';
const NOW = '2026-10-15T20:00:00.000Z';
const TODAY = '2026-10-15';
const CLOSING_DAYS = [1, 15, 28, 31] as const;
// 60 is the smallest total that still gives each of 60 payments one minor unit; the last is past 2^53.
const TOTALS = [60n, 10001n, 12345678n, 9007199254740993n] as const;
const INSTALLMENT_COUNTS = [2, 3, 12, 60] as const;
const DAY_MS = 86_400_000;

type DateKind = 'closing-day' | 'day-after' | 'before-first' | 'today';

interface SweepCase {
  closingDay: number;
  purchasedOn: string;
  kinds: DateKind[];
  total: bigint;
  count: number;
  /** Closing date of the first stored statement of the card. */
  firstStatementClosing: string;
  preview: InstallmentSchedule;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function describeInput(input: Pick<SweepCase, 'closingDay' | 'purchasedOn' | 'total' | 'count'>) {
  return `closingDay=${input.closingDay} purchasedOn=${input.purchasedOn} total=${input.total} count=${input.count}`;
}

interface Landed {
  period: string;
  closingDate: string;
  dueDate: string;
  amount: bigint;
}

/** Throws naming the input when what the use case stored differs from the preview. */
function assertParity(input: SweepCase, landed: readonly Landed[], statuses?: string[]): void {
  const fail = (what: string): never => {
    throw new Error(`Preview and API disagree on ${what} for ${describeInput(input)}`);
  };
  const { rows, kind } = input.preview;
  if (kind !== (input.count === 1 ? 'expense' : 'installments')) fail('the kind');
  if (rows.length !== landed.length)
    fail(`the number of payments (${rows.length} vs ${landed.length})`);
  rows.forEach((row, index) => {
    const stored = landed[index];
    if (!stored) return fail(`payment ${index + 1}`);
    if (row.amount !== stored.amount) {
      fail(`the amount of payment ${row.number} (${row.amount} vs ${stored.amount})`);
    }
    if (row.period !== stored.period) {
      fail(`the statement period of payment ${row.number} (${row.period} vs ${stored.period})`);
    }
    if (row.closingDate !== stored.closingDate) fail(`the closing date of payment ${row.number}`);
    if (row.dueDate !== stored.dueDate) fail(`the due date of payment ${row.number}`);
    if (statuses && (row.closed ? 'closed' : 'open') !== statuses[index]) {
      fail(`the closed state of payment ${row.number}`);
    }
  });
}

/** Runs the real use cases over the grid and compares each result with `preview`. */
async function sweep(preview: Preview, counts: readonly number[]): Promise<SweepCase[]> {
  const cases: SweepCase[] = [];
  const scope = await writeScopeFor(ANA);
  for (const closingDay of CLOSING_DAYS) {
    const cards = new InMemoryCreditCards();
    const clock = new FakeClock(new Date(CARD_CREATED_AT));
    const recorder = new FakeExpenseRecorder(clock);
    const deps = {
      cards,
      activity: new FakeActivity(),
      timeZones: new FakeTimeZones(),
      clock,
      purchases: new FakeCardPurchases(recorder),
      expenses: recorder,
      ...installmentFakes(),
    };
    const card = await new CreateCreditCard(deps).execute(scope, {
      name: 'Visa',
      closingDay,
      dueDay: 10,
    });
    // The web reads the card's statements when the form opens, newest first.
    clock.current = new Date(NOW);
    const listed = await new ListStatements(deps).execute(scope, card.id);
    const statements = listed.map(({ period, closingDate, dueDate }) => ({
      period,
      closingDate,
      dueDate,
    }));
    const chronological = [...statements].reverse();
    const first = chronological[0];
    if (!first) throw new Error('A card always has a statement');

    const kindsByDate = new Map<string, DateKind[]>();
    const tag = (date: string, kind: DateKind) => {
      if (date > TODAY) return;
      kindsByDate.set(date, [...(kindsByDate.get(date) ?? []), kind]);
    };
    for (const statement of chronological) {
      tag(statement.closingDate, 'closing-day');
      tag(shiftDate(statement.closingDate, 1), 'day-after');
    }
    tag(shiftDate(first.closingDate, -1), 'before-first');
    tag(shiftDate(first.closingDate, -45), 'before-first');
    tag(TODAY, 'today');

    for (const [purchasedOn, kinds] of kindsByDate) {
      for (const total of TOTALS) {
        for (const count of counts) {
          const previewed = preview({
            total,
            count,
            purchasedOn,
            today: TODAY,
            card: { closingDay, dueDay: 10 },
            statements,
          });
          const input: SweepCase = {
            closingDay,
            purchasedOn,
            kinds,
            total,
            count,
            firstStatementClosing: first.closingDate,
            preview: previewed,
          };
          if (count === 1) {
            const recorded = await new RecordCardExpense(deps).execute(scope, card.id, {
              currency: 'ARS',
              categoryId: CATEGORY,
              amount: total,
              // Noon in Buenos Aires, the zone of the fake: the purchase day is `purchasedOn`.
              occurredAt: new Date(`${purchasedOn}T15:00:00.000Z`),
              rate: { source: 'automatic' },
            });
            const statement = listed.find((item) => item.id === recorded.statementId);
            if (!statement) {
              throw new Error(`No statement assigned for ${describeInput(input)}`);
            }
            assertParity(input, [{ ...statement, amount: recorded.amount }]);
          } else {
            const created = await new CreateInstallmentPurchase(deps).execute(scope, card.id, {
              categoryId: CATEGORY,
              currency: 'ARS',
              amount: total,
              installments: count,
              purchasedOn,
            });
            assertParity(
              input,
              created.installments,
              created.installments.map((installment) => installment.status),
            );
          }
          cases.push(input);
        }
      }
    }
  }
  return cases;
}

describe('installment preview parity with the API (AC-11)', () => {
  it('matches the installments stored for 2 to 60 payments', async () => {
    const cases = await sweep(previewInstallmentSchedule, INSTALLMENT_COUNTS);

    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((item) => item.count))).toEqual(new Set(INSTALLMENT_COUNTS));
    expect(cases.every((item) => item.preview.kind === 'installments')).toBe(true);
  });

  it('matches the statement assigned to a single payment', async () => {
    const cases = await sweep(previewInstallmentSchedule, [1]);

    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((item) => item.count === 1 && item.preview.kind === 'expense')).toBe(true);
  });

  it('covers a closing day, the day after, dates before the first statement and today (AC-04)', async () => {
    const cases = await sweep(previewInstallmentSchedule, [1, 3]);

    for (const closingDay of CLOSING_DAYS) {
      const own = cases.filter((item) => item.closingDay === closingDay);
      const of = (kind: DateKind) => own.filter((item) => item.kinds.includes(kind));

      expect(of('closing-day').length).toBeGreaterThan(0);
      expect(of('day-after').length).toBeGreaterThan(0);
      expect(of('before-first').length).toBeGreaterThan(0);
      expect(of('today').length).toBeGreaterThan(0);
      // A purchase on the closing day stays in that statement; the day after goes to the next.
      for (const item of of('closing-day')) {
        expect(item.preview.rows[0]?.closingDate).toBe(item.purchasedOn);
      }
      for (const item of of('day-after')) {
        expect((item.preview.rows[0]?.closingDate ?? '') > item.purchasedOn).toBe(true);
      }
      // Before the first statement the purchase still lands on it.
      for (const item of of('before-first')) {
        expect(item.purchasedOn < item.firstStatementClosing).toBe(true);
        expect(item.preview.rows[0]?.closingDate).toBe(item.firstStatementClosing);
      }
    }
  });

  it('fails naming the input when the preview is altered (the comparison can fail)', async () => {
    const shiftFirstPeriod: Preview = (input) => {
      const schedule = previewInstallmentSchedule(input);
      return {
        ...schedule,
        rows: schedule.rows.map((row, index) =>
          index === 0 ? { ...row, period: nextPeriod(row.period) } : row,
        ),
      };
    };

    const error = await sweep(shiftFirstPeriod, INSTALLMENT_COUNTS).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/statement period of payment 1/);
    expect(message).toMatch(/closingDay=1 purchasedOn=\d{4}-\d{2}-\d{2} total=60 count=2$/);
  });

  it('fails naming the input when a one-payment preview assigns another statement', async () => {
    const shiftFirstPeriod: Preview = (input) => {
      const schedule = previewInstallmentSchedule(input);
      return {
        ...schedule,
        rows: schedule.rows.map((row) => ({ ...row, period: nextPeriod(row.period) })),
      };
    };

    await expect(sweep(shiftFirstPeriod, [1])).rejects.toThrow(/count=1$/);
  });
});
