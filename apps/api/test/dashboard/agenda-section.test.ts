import { describe, expect, it } from 'vitest';
import { buildAgenda } from '../../src/dashboard/application/build-agenda';
import type { DashboardContext } from '../../src/dashboard/application/dashboard-context';
import type { AccountCurrencyReader } from '../../src/dashboard/application/ports/account-currency-reader';
import type { CardStatementSource } from '../../src/dashboard/application/ports/card-statement-source';
import type { DueStatement } from '../../src/dashboard/domain/agenda';
import type { UpcomingEntry } from '../../src/recurring';
import type { AccessScope } from '../../src/shared/access';
import { readScope } from '../movements/db-fixtures';

const USER = '00000000-0000-4000-8000-0000000000aa';
const ACCOUNT_ARS = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT_USD = '00000000-0000-4000-8000-0000000000a2';

const context: DashboardContext = {
  preferences: {
    displayCurrency: 'ARS',
    defaultRateType: 'mep',
    timeZone: 'America/Argentina/Buenos_Aires',
  },
  today: '2026-10-06',
  month: '2026-10',
  monthStart: '2026-10-01',
  userId: USER,
};

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

function entry(n: number, overrides: Partial<UpcomingEntry> = {}): UpcomingEntry {
  return {
    kind: 'scheduled',
    dueDate: '2026-10-09',
    paymentId: uuid(n),
    name: `Payment ${n}`,
    amount: 1000n,
    accountId: ACCOUNT_ARS,
    categoryId: uuid(500),
    occurrenceId: null,
    ...overrides,
  };
}

class FakeCurrencies implements AccountCurrencyReader {
  calls: string[][] = [];

  constructor(
    private readonly map = new Map<string, 'ARS' | 'USD'>([
      [ACCOUNT_ARS, 'ARS'],
      [ACCOUNT_USD, 'USD'],
    ]),
  ) {}

  currenciesOf(_scope: AccessScope, ids: readonly string[]) {
    this.calls.push([...ids]);
    return Promise.resolve(this.map);
  }
}

class FakeStatements implements CardStatementSource {
  calls: Array<{ today: string; timeZone: string }> = [];

  constructor(
    private readonly rows: DueStatement[] = [],
    private readonly failure?: Error,
  ) {}

  dueStatements(_scope: AccessScope, today: string, timeZone: string) {
    this.calls.push({ today, timeZone });
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.rows);
  }
}

function build(
  entries: UpcomingEntry[],
  statements: CardStatementSource,
  currencies = new FakeCurrencies(),
) {
  const upcomingCalls: DashboardContext[] = [];
  return {
    currencies,
    upcomingCalls,
    deps: {
      upcoming: (ctx: DashboardContext) => {
        upcomingCalls.push(ctx);
        return { execute: () => Promise.resolve(entries) };
      },
      currencies,
      statements,
    },
  };
}

describe('buildAgenda', () => {
  it('returns the hand-ordered lists with currencies and reads the currencies once', async () => {
    const scope = await readScope(USER);
    const statement: DueStatement = {
      cardId: uuid(101),
      cardName: 'Visa',
      statementId: uuid(201),
      dueDate: '2026-10-08',
      closed: true,
      owed: { ARS: 7n, USD: 0n },
    };
    const { deps, currencies, upcomingCalls } = build(
      [
        entry(1, { dueDate: '2026-10-11', accountId: ACCOUNT_USD, amount: 20n }),
        entry(2, { kind: 'pending', dueDate: '2026-10-06', occurrenceId: uuid(901) }),
        entry(3, { dueDate: '2026-10-09' }),
      ],
      new FakeStatements([statement]),
    );

    const result = await buildAgenda(deps, scope, context);

    expect(result.upcoming).toEqual([
      expect.objectContaining({ paymentId: uuid(3), currency: 'ARS', date: '2026-10-09' }),
      expect.objectContaining({ paymentId: uuid(1), currency: 'USD', amount: 20n }),
    ]);
    expect(result.actions.map((item) => item.kind)).toEqual([
      'pending_occurrence',
      'unpaid_statement',
    ]);
    expect(currencies.calls).toHaveLength(1);
    expect(currencies.calls[0]).toEqual(expect.arrayContaining([ACCOUNT_ARS, ACCOUNT_USD]));
    expect(upcomingCalls).toEqual([context]);
  });

  it('asks the statement source for today and the stored zone', async () => {
    const scope = await readScope(USER);
    const statements = new FakeStatements();

    await buildAgenda(build([], statements).deps, scope, context);

    expect(statements.calls).toEqual([
      { today: '2026-10-06', timeZone: 'America/Argentina/Buenos_Aires' },
    ]);
  });

  it('throws for an entry whose account is unknown and guesses no currency (FR-16)', async () => {
    const scope = await readScope(USER);
    const { deps } = build(
      [entry(1, { accountId: uuid(777) })],
      new FakeStatements(),
      new FakeCurrencies(new Map()),
    );

    await expect(buildAgenda(deps, scope, context)).rejects.toThrow(/account/i);
  });

  it('rejects the whole section when the statement source fails (FR-16)', async () => {
    const scope = await readScope(USER);
    const { deps } = build([entry(1)], new FakeStatements([], new Error('boom')));

    await expect(buildAgenda(deps, scope, context)).rejects.toThrow('boom');
  });
});
