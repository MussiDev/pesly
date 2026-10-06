import { randomUUID } from 'node:crypto';
import type { AccountActivity } from '../../src/credit-cards/application/ports/account-activity';
import type { Clock } from '../../src/credit-cards/application/ports/clock';
import type {
  CardDays,
  CreateCreditCardData,
  CreditCardRepository,
  StatementDates,
} from '../../src/credit-cards/application/ports/credit-card-repository';
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

export class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current;
  }
}
