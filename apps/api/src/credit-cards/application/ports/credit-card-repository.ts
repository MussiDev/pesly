import type { AccessScope } from '../../../shared/access';
import type { CreditCard, Statement, StatementDraft } from '../../domain/credit-card';
import type { CardDays } from '../../domain/statement-schedule';

export type { CardDays } from '../../domain/statement-schedule';

export interface StatementDates {
  closingDate: string;
  dueDate: string;
}

export interface CreateCreditCardData extends CardDays {
  name: string;
  firstStatement: StatementDraft;
}

/**
 * Cards and their statements. Every method filters by the scope in the same statement; a card that
 * is missing or not the caller's reads as `null`, an empty list or `false`.
 */
export interface CreditCardRepository {
  /**
   * Creates the card, its two linked accounts ("<name> ARS", "<name> USD") and its first statement
   * atomically. A taken account name rejects with `CardAccountNameTaken` and stores nothing.
   */
  create(
    scope: AccessScope<'write'>,
    data: CreateCreditCardData,
  ): Promise<{ card: CreditCard; statement: Statement }>;
  /** The caller's cards, oldest first. */
  list(scope: AccessScope): Promise<CreditCard[]>;
  findById(scope: AccessScope, id: string): Promise<CreditCard | null>;
  /** The card's statements ordered by closing date, oldest first. */
  listStatements(scope: AccessScope, cardId: string): Promise<Statement[]>;
  /** Inserts the drafts; a period the card already has is left as it is. */
  insertStatements(
    scope: AccessScope<'write'>,
    cardId: string,
    drafts: readonly StatementDraft[],
  ): Promise<void>;
  updateStatement(
    scope: AccessScope<'write'>,
    cardId: string,
    statementId: string,
    dates: StatementDates,
  ): Promise<Statement | null>;
  /** Saves the days and the recomputed statements atomically. */
  updateDays(
    scope: AccessScope<'write'>,
    cardId: string,
    days: CardDays,
    statements: readonly Statement[],
  ): Promise<CreditCard | null>;
  /**
   * Deletes the card, its statements and both linked accounts atomically. A movement on a linked
   * account rejects with `CardHasMovements` and deletes nothing.
   */
  delete(scope: AccessScope<'write'>, card: CreditCard): Promise<boolean>;
}
