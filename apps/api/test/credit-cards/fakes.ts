import { randomUUID } from 'node:crypto';
import { dateInTimeZone } from '@pesly/shared';
import type { AccountActivity } from '../../src/credit-cards/application/ports/account-activity';
import type { CardPayments } from '../../src/credit-cards/application/ports/card-payments';
import type { CardPurchases } from '../../src/credit-cards/application/ports/card-purchases';
import type { Clock } from '../../src/credit-cards/application/ports/clock';
import type { ExpenseCategoryGuard } from '../../src/credit-cards/application/ports/expense-category-guard';
import type {
  InstallmentPurchaseChange,
  InstallmentRepository,
  NewInstallmentPurchase,
} from '../../src/credit-cards/application/ports/installment-repository';
import type {
  InstallmentWriteLimit,
  WriteUnit,
} from '../../src/credit-cards/application/ports/installment-write-limit';
import type {
  InstallmentPurchase,
  InstallmentRow,
} from '../../src/credit-cards/domain/installment';
import type {
  ExpenseRecorder,
  ExpenseToRecord,
} from '../../src/credit-cards/application/ports/expense-recorder';
import type {
  DailyPurchase,
  StatementTotals,
} from '../../src/credit-cards/domain/statement-assignment';
import type {
  CardDays,
  CreateCreditCardData,
  CreditCardRepository,
  StatementDates,
} from '../../src/credit-cards/application/ports/credit-card-repository';
import type {
  PaymentToRecord,
  RecordedPaymentMovement,
  StatementPaymentRecorder,
} from '../../src/credit-cards/application/ports/statement-payment-recorder';
import type { StatementImportRepository } from '../../src/credit-cards/application/ports/statement-import-repository';
import type { UserTimeZone } from '../../src/credit-cards/application/ports/user-time-zone';
import {
  linkedAccountNames,
  type CreditCard,
  type Statement,
  type StatementDraft,
} from '../../src/credit-cards/domain/credit-card';
import { CardAccountNameTaken } from '../../src/credit-cards/domain/errors';
import type { AccessScope } from '../../src/shared/access';

export { readScopeFor, writeScopeFor } from '../accounts/fakes';

interface CardRow {
  ownerId: string;
  card: CreditCard;
}

/** In-memory repository: rows are visible only to their owner; taken account names collide. */
export class InMemoryCreditCards implements CreditCardRepository {
  readonly cards = new Map<string, CardRow>();
  readonly statements = new Map<string, Statement>();
  /** Lower-cased account names per owner, standing in for the accounts table. */
  readonly accountNames = new Map<string, Set<string>>();
  readonly deletedAccounts: string[] = [];

  private namesOf(ownerId: string): Set<string> {
    let names = this.accountNames.get(ownerId);
    if (!names) {
      names = new Set();
      this.accountNames.set(ownerId, names);
    }
    return names;
  }

  private visible(scope: AccessScope, id: string): CreditCard | null {
    const row = this.cards.get(id);
    return row && row.ownerId === scope.userId ? row.card : null;
  }

  create(
    scope: AccessScope<'write'>,
    data: CreateCreditCardData,
  ): Promise<{ card: CreditCard; statement: Statement }> {
    const names = linkedAccountNames(data.name);
    const taken = this.namesOf(scope.userId);
    if (taken.has(names.ARS.toLowerCase()) || taken.has(names.USD.toLowerCase())) {
      return Promise.reject(new CardAccountNameTaken());
    }
    taken.add(names.ARS.toLowerCase());
    taken.add(names.USD.toLowerCase());
    const card: CreditCard = {
      id: randomUUID(),
      name: data.name,
      closingDay: data.closingDay,
      dueDay: data.dueDay,
      arsAccountId: randomUUID(),
      usdAccountId: randomUUID(),
      createdAt: new Date('2026-10-06T12:00:00.000Z'),
    };
    this.cards.set(card.id, { ownerId: scope.userId, card });
    const statement = this.store(card.id, data.firstStatement);
    return Promise.resolve({ card, statement });
  }

  private store(cardId: string, draft: StatementDraft): Statement {
    const statement: Statement = { id: randomUUID(), cardId, ...draft };
    this.statements.set(statement.id, statement);
    return statement;
  }

  list(scope: AccessScope): Promise<CreditCard[]> {
    return Promise.resolve(
      [...this.cards.values()].filter((row) => row.ownerId === scope.userId).map((row) => row.card),
    );
  }

  findById(scope: AccessScope, id: string): Promise<CreditCard | null> {
    return Promise.resolve(this.visible(scope, id));
  }

  listStatements(scope: AccessScope, cardId: string): Promise<Statement[]> {
    if (!this.visible(scope, cardId)) return Promise.resolve([]);
    return Promise.resolve(
      [...this.statements.values()]
        .filter((statement) => statement.cardId === cardId)
        .sort((a, b) => a.closingDate.localeCompare(b.closingDate)),
    );
  }

  insertStatements(
    scope: AccessScope<'write'>,
    cardId: string,
    drafts: readonly StatementDraft[],
  ): Promise<void> {
    if (!this.visible(scope, cardId)) return Promise.resolve();
    for (const draft of drafts) {
      const exists = [...this.statements.values()].some(
        (statement) => statement.cardId === cardId && statement.period === draft.period,
      );
      if (!exists) this.store(cardId, draft);
    }
    return Promise.resolve();
  }

  updateStatement(
    scope: AccessScope<'write'>,
    cardId: string,
    statementId: string,
    dates: StatementDates,
  ): Promise<Statement | null> {
    const statement = this.statements.get(statementId);
    if (!this.visible(scope, cardId) || statement?.cardId !== cardId) return Promise.resolve(null);
    const updated = { ...statement, ...dates };
    this.statements.set(statementId, updated);
    return Promise.resolve(updated);
  }

  updateDays(
    scope: AccessScope<'write'>,
    cardId: string,
    days: CardDays,
    statements: readonly Statement[],
  ): Promise<CreditCard | null> {
    const row = this.cards.get(cardId);
    if (!row || row.ownerId !== scope.userId) return Promise.resolve(null);
    row.card = { ...row.card, ...days };
    for (const statement of statements) this.statements.set(statement.id, statement);
    return Promise.resolve(row.card);
  }

  delete(scope: AccessScope<'write'>, card: CreditCard): Promise<boolean> {
    if (!this.visible(scope, card.id)) return Promise.resolve(false);
    this.cards.delete(card.id);
    for (const [id, statement] of this.statements) {
      if (statement.cardId === card.id) this.statements.delete(id);
    }
    this.deletedAccounts.push(card.arsAccountId, card.usdAccountId);
    return Promise.resolve(true);
  }
}

export class FakeActivity implements AccountActivity {
  readonly withMovements = new Set<string>();

  hasMovements(accountId: string): Promise<boolean> {
    return Promise.resolve(this.withMovements.has(accountId));
  }
}

export class FakeTimeZones implements UserTimeZone {
  zone = 'America/Argentina/Buenos_Aires';

  timeZoneOf(): Promise<string> {
    return Promise.resolve(this.zone);
  }
}

export interface RecordedExpense {
  ownerId: string;
  id: string;
  accountId: string;
  categoryId: string;
  amount: bigint;
  occurredAt: Date;
  note?: string;
  rate: ExpenseToRecord['rate'];
}

/** Stores expenses in memory; refuses a future date like the movements rules do. */
export class FakeExpenseRecorder implements ExpenseRecorder {
  readonly expenses: RecordedExpense[] = [];
  /** When set, the next call rejects with it and stores nothing. */
  failWith: Error | null = null;

  /** How many expenses came through the path that spends no creation limit unit. */
  unmetered = 0;

  constructor(private readonly clock: Clock) {}

  recordUnmetered(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    this.unmetered += 1;
    return this.record(scope, expense);
  }

  record(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    if (this.failWith) return Promise.reject(this.failWith);
    if (expense.occurredAt.getTime() > this.clock.now().getTime()) {
      return Promise.reject(new Error('MOVEMENT_DATE_IN_FUTURE'));
    }
    const id = randomUUID();
    this.expenses.push({ ownerId: scope.userId, id, ...expense });
    return Promise.resolve({ id, occurredAt: expense.occurredAt });
  }
}

/** Derives the daily sums from the expenses a `FakeExpenseRecorder` stored, as the SQL adapter does. */
export class FakeCardPurchases implements CardPurchases {
  constructor(private readonly recorder: FakeExpenseRecorder) {}

  dailyPurchases(scope: AccessScope, card: CreditCard, timeZone: string): Promise<DailyPurchase[]> {
    const sums = new Map<string, DailyPurchase>();
    for (const expense of this.recorder.expenses) {
      if (expense.ownerId !== scope.userId) continue;
      const currency =
        expense.accountId === card.arsAccountId
          ? 'ARS'
          : expense.accountId === card.usdAccountId
            ? 'USD'
            : null;
      if (!currency) continue;
      const day = dateInTimeZone(expense.occurredAt, timeZone);
      const key = `${day}|${currency}`;
      const previous = sums.get(key);
      sums.set(key, { day, currency, amount: (previous?.amount ?? 0n) + expense.amount });
    }
    return Promise.resolve([...sums.values()]);
  }
}

export class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current;
  }
}

interface PurchaseRow {
  ownerId: string;
  purchase: InstallmentPurchase;
  cancelled: boolean;
}

/** In-memory installments: rows are visible only to their owner and card, like the SQL scope. */
export class InMemoryInstallments implements InstallmentRepository {
  readonly purchases = new Map<string, PurchaseRow>();

  create(scope: AccessScope<'write'>, data: NewInstallmentPurchase): Promise<InstallmentPurchase> {
    const purchase: InstallmentPurchase = {
      id: randomUUID(),
      cardId: data.cardId,
      categoryId: data.categoryId,
      totalAmount: data.totalAmount,
      currency: data.currency,
      installmentCount: data.installments.length,
      purchasedOn: data.purchasedOn,
      note: data.note,
      createdAt: new Date('2026-10-06T12:00:00.000Z'),
      installments: data.installments.map((installment) => ({ ...installment })),
    };
    this.purchases.set(purchase.id, { ownerId: scope.userId, purchase, cancelled: false });
    return Promise.resolve(purchase);
  }

  private active(scope: AccessScope, cardId: string, purchaseId: string): PurchaseRow | null {
    const row = this.purchases.get(purchaseId);
    return row && row.ownerId === scope.userId && row.purchase.cardId === cardId && !row.cancelled
      ? row
      : null;
  }

  listPurchases(scope: AccessScope, cardId: string): Promise<InstallmentPurchase[]> {
    return Promise.resolve(
      [...this.purchases.values()]
        .filter((row) => row.ownerId === scope.userId && row.purchase.cardId === cardId)
        .filter((row) => !row.cancelled)
        .map((row) => row.purchase),
    );
  }

  findPurchase(
    scope: AccessScope,
    cardId: string,
    purchaseId: string,
  ): Promise<InstallmentPurchase | null> {
    return Promise.resolve(this.active(scope, cardId, purchaseId)?.purchase ?? null);
  }

  updatePurchase(
    scope: AccessScope<'write'>,
    cardId: string,
    purchaseId: string,
    change: InstallmentPurchaseChange,
  ): Promise<InstallmentPurchase | null> {
    const row = this.active(scope, cardId, purchaseId);
    if (!row) return Promise.resolve(null);
    row.purchase = {
      ...row.purchase,
      ...(change.categoryId === undefined ? {} : { categoryId: change.categoryId }),
      ...(change.note === undefined ? {} : { note: change.note }),
    };
    return Promise.resolve(row.purchase);
  }

  removeInstallments(
    scope: AccessScope<'write'>,
    cardId: string,
    purchaseId: string,
    numbers: readonly number[],
  ): Promise<boolean> {
    const row = this.active(scope, cardId, purchaseId);
    if (!row) return Promise.resolve(false);
    row.purchase = {
      ...row.purchase,
      installments: row.purchase.installments.filter((i) => !numbers.includes(i.number)),
    };
    if (row.purchase.installments.length === 0) this.purchases.delete(purchaseId);
    else row.cancelled = true;
    return Promise.resolve(true);
  }

  listRows(scope: AccessScope, cardId?: string): Promise<InstallmentRow[]> {
    return Promise.resolve(
      [...this.purchases.values()]
        .filter((row) => row.ownerId === scope.userId)
        .filter((row) => cardId === undefined || row.purchase.cardId === cardId)
        .flatMap((row) =>
          row.purchase.installments.map((installment) => ({
            cardId: row.purchase.cardId,
            purchaseId: row.purchase.id,
            number: installment.number,
            count: row.purchase.installmentCount,
            period: installment.period,
            amount: installment.amount,
            currency: row.purchase.currency,
            categoryId: row.purchase.categoryId,
          })),
        ),
    );
  }

  cardHasPurchases(scope: AccessScope, cardId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.purchases.values()].some(
        (row) => row.ownerId === scope.userId && row.purchase.cardId === cardId,
      ),
    );
  }
}

/** Accepts any category except the ids put in `rejected`, which throw the error given. */
export class FakeCategoryGuard implements ExpenseCategoryGuard {
  readonly rejected = new Map<string, Error>();

  assertOpenExpenseCategory(_scope: AccessScope<'write'>, categoryId: string): Promise<void> {
    const error = this.rejected.get(categoryId);
    return error ? Promise.reject(error) : Promise.resolve();
  }
}

/** Allows `limit` creations, then throws the error given; counts refunds. */
export class FakeWriteLimit implements InstallmentWriteLimit {
  taken = 0;
  released = 0;
  limit = Number.POSITIVE_INFINITY;
  exhausted: Error = new Error('RATE_LIMITED');

  take(): Promise<WriteUnit> {
    if (this.taken >= this.limit) return Promise.reject(this.exhausted);
    this.taken += 1;
    return Promise.resolve({
      release: () => {
        this.released += 1;
        return Promise.resolve();
      },
    });
  }
}

export interface RecordedPayment extends PaymentToRecord {
  ownerId: string;
  id: string;
}

/** Stores transfers in memory; the movements rules (currency, archived, future) are the adapter's. */
export class FakePaymentRecorder implements StatementPaymentRecorder {
  readonly payments: RecordedPayment[] = [];
  /** When set, the next call rejects with it and stores nothing. */
  failWith: Error | null = null;

  record(scope: AccessScope<'write'>, payment: PaymentToRecord): Promise<RecordedPaymentMovement> {
    if (this.failWith) return Promise.reject(this.failWith);
    const id = randomUUID();
    this.payments.push({ ownerId: scope.userId, id, ...payment });
    const exchange =
      payment.pesosDebited === undefined
        ? null
        : { pesosAmount: payment.pesosDebited, rate: 15_350_000n };
    return Promise.resolve({ id, occurredAt: payment.occurredAt, exchange });
  }
}

/** Sums the transfers a `FakePaymentRecorder` stored per linked account, as the SQL adapter does. */
export class FakeCardPayments implements CardPayments {
  constructor(private readonly recorder: FakePaymentRecorder) {}

  receivedByCard(scope: AccessScope, card: CreditCard): Promise<StatementTotals> {
    const received: StatementTotals = { ARS: 0n, USD: 0n };
    for (const payment of this.recorder.payments) {
      if (payment.ownerId !== scope.userId) continue;
      if (payment.destinationAccountId === card.arsAccountId) received.ARS += payment.amount;
      if (payment.destinationAccountId === card.usdAccountId) received.USD += payment.amount;
    }
    return Promise.resolve(received);
  }
}

/** In-memory fingerprints, scoped by owner and card like the SQL table. */
export class InMemoryStatementImports implements StatementImportRepository {
  readonly claimed = new Set<string>();

  claim(scope: AccessScope<'write'>, cardId: string, fingerprint: string): Promise<boolean> {
    const key = `${scope.userId}|${cardId}|${fingerprint}`;
    if (this.claimed.has(key)) return Promise.resolve(false);
    this.claimed.add(key);
    return Promise.resolve(true);
  }

  release(scope: AccessScope<'write'>, cardId: string, fingerprint: string): Promise<void> {
    this.claimed.delete(`${scope.userId}|${cardId}|${fingerprint}`);
    return Promise.resolve();
  }
}

/** The collaborators of the installment use cases, with in-memory stand-ins. */
export function installmentFakes() {
  const paymentRecorder = new FakePaymentRecorder();
  return {
    paymentRecorder,
    cardPayments: new FakeCardPayments(paymentRecorder),
    installments: new InMemoryInstallments(),
    categories: new FakeCategoryGuard(),
    writeLimit: new FakeWriteLimit(),
    statementImports: new InMemoryStatementImports(),
  };
}
