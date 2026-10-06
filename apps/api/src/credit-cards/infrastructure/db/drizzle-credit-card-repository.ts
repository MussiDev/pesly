import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import type {
  CardDays,
  CreateCreditCardData,
  CreditCardRepository,
  StatementDates,
} from '../../application/ports/credit-card-repository';
import {
  linkedAccountNames,
  type CreditCard,
  type Statement,
  type StatementDraft,
} from '../../domain/credit-card';
import { CardAccountNameTaken, CardHasMovements } from '../../domain/errors';
import { accounts } from './foreign-relations';
import { creditCards, creditCardStatements } from './schema';

const cardColumns = {
  id: creditCards.id,
  name: creditCards.name,
  closingDay: creditCards.closingDay,
  dueDay: creditCards.dueDay,
  arsAccountId: creditCards.arsAccountId,
  usdAccountId: creditCards.usdAccountId,
  createdAt: creditCards.createdAt,
};

const statementColumns = {
  id: creditCardStatements.id,
  cardId: creditCardStatements.cardId,
  period: creditCardStatements.period,
  closingDate: creditCardStatements.closingDate,
  dueDate: creditCardStatements.dueDate,
};

const ownCard = (scope: AccessScope, id: string) =>
  and(eq(creditCards.id, id), scopedTo(scope, { owner: creditCards.ownerId }));

const ownStatements = (scope: AccessScope, cardId: string) =>
  and(
    eq(creditCardStatements.cardId, cardId),
    scopedTo(scope, { owner: creditCardStatements.ownerId }),
  );

export class DrizzleCreditCardRepository implements CreditCardRepository {
  constructor(private readonly db: Database) {}

  async create(
    scope: AccessScope<'write'>,
    data: CreateCreditCardData,
  ): Promise<{ card: CreditCard; statement: Statement }> {
    const names = linkedAccountNames(data.name);
    try {
      return await this.db.transaction(async (tx) => {
        // The values the accounts module stores for a credit card: no opening balance and never
        // part of the available total (FEAT-003 FR-05).
        const linked = await tx
          .insert(accounts)
          .values(
            (['ARS', 'USD'] as const).map((currency) => ({
              ownerId: scope.userId,
              name: names[currency],
              type: 'credit_card' as const,
              currency,
              openingBalance: 0n,
              includeInAvailable: false,
            })),
          )
          .returning({ id: accounts.id, currency: accounts.currency });
        const ars = linked.find((row) => row.currency === 'ARS');
        const usd = linked.find((row) => row.currency === 'USD');
        if (!ars || !usd) throw new Error('Inserting the linked accounts returned no rows');
        const [card] = await tx
          .insert(creditCards)
          .values({
            ownerId: scope.userId,
            name: data.name,
            closingDay: data.closingDay,
            dueDay: data.dueDay,
            arsAccountId: ars.id,
            usdAccountId: usd.id,
          })
          .returning(cardColumns);
        if (!card) throw new Error('Inserting a credit card returned no row');
        const [statement] = await tx
          .insert(creditCardStatements)
          .values({ cardId: card.id, ownerId: scope.userId, ...data.firstStatement })
          .returning(statementColumns);
        if (!statement) throw new Error('Inserting a statement returned no row');
        return { card, statement };
      });
    } catch (error) {
      if (violatedConstraint(error, '23505') === 'accounts_owner_name_unique') {
        throw new CardAccountNameTaken();
      }
      throw error;
    }
  }

  list(scope: AccessScope): Promise<CreditCard[]> {
    return this.db
      .select(cardColumns)
      .from(creditCards)
      .where(scopedTo(scope, { owner: creditCards.ownerId }))
      .orderBy(asc(creditCards.createdAt), asc(creditCards.id));
  }

  async findById(scope: AccessScope, id: string): Promise<CreditCard | null> {
    const [row] = await this.db
      .select(cardColumns)
      .from(creditCards)
      .where(ownCard(scope, id))
      .limit(1);
    return row ?? null;
  }

  listStatements(scope: AccessScope, cardId: string): Promise<Statement[]> {
    return this.db
      .select(statementColumns)
      .from(creditCardStatements)
      .where(ownStatements(scope, cardId))
      .orderBy(asc(creditCardStatements.closingDate));
  }

  async insertStatements(
    scope: AccessScope<'write'>,
    cardId: string,
    drafts: readonly StatementDraft[],
  ): Promise<void> {
    if (drafts.length === 0 || !(await this.findById(scope, cardId))) return;
    await this.db
      .insert(creditCardStatements)
      .values(drafts.map((draft) => ({ cardId, ownerId: scope.userId, ...draft })))
      .onConflictDoNothing({ target: [creditCardStatements.cardId, creditCardStatements.period] });
  }

  async updateStatement(
    scope: AccessScope<'write'>,
    cardId: string,
    statementId: string,
    dates: StatementDates,
  ): Promise<Statement | null> {
    const [row] = await this.db
      .update(creditCardStatements)
      .set({ ...dates, updatedAt: new Date() })
      .where(and(ownStatements(scope, cardId), eq(creditCardStatements.id, statementId)))
      .returning(statementColumns);
    return row ?? null;
  }

  updateDays(
    scope: AccessScope<'write'>,
    cardId: string,
    days: CardDays,
    statements: readonly Statement[],
  ): Promise<CreditCard | null> {
    return this.db.transaction(async (tx) => {
      const [card] = await tx
        .update(creditCards)
        .set({ ...days, updatedAt: new Date() })
        .where(ownCard(scope, cardId))
        .returning(cardColumns);
      if (!card) return null;
      for (const statement of statements) {
        await tx
          .update(creditCardStatements)
          .set({
            closingDate: statement.closingDate,
            dueDate: statement.dueDate,
            updatedAt: new Date(),
          })
          .where(and(ownStatements(scope, cardId), eq(creditCardStatements.id, statement.id)));
      }
      return card;
    });
  }

  async delete(scope: AccessScope<'write'>, card: CreditCard): Promise<boolean> {
    try {
      return await this.db.transaction(async (tx) => {
        const deleted = await tx
          .delete(creditCards)
          .where(ownCard(scope, card.id))
          .returning({ id: creditCards.id });
        if (deleted.length === 0) return false;
        await tx
          .delete(accounts)
          .where(
            and(
              inArray(accounts.id, [card.arsAccountId, card.usdAccountId]),
              scopedTo(scope, { owner: accounts.ownerId }),
            ),
          );
        return true;
      });
    } catch (error) {
      // A movement recorded on a linked account between the check and the delete.
      if (violatedConstraint(error, '23503') !== undefined) throw new CardHasMovements();
      throw error;
    }
  }
}
