import { addDays } from '@pesly/shared';
import {
  DrizzleCreditCardRepository,
  DrizzleInstallmentRepository,
  buildStatementViews,
  unpaidRemainder,
  type CardPayments,
  type CardPurchases,
  type InstallmentRepository,
  type InstallmentRow,
} from '../../../credit-cards';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { CardStatementSource } from '../../application/ports/card-statement-source';
import { AGENDA_UPCOMING_DAYS, type DueStatement } from '../../domain/agenda';

export interface CardStatementSourceDependencies {
  db: Database;
  purchases: CardPurchases;
  cardPayments: CardPayments;
}

function readOnly(): never {
  throw new Error('The preloaded installment rows only support listRows');
}

/** Serves the rows read once for all the cards; only reading is supported. */
class PreloadedInstallments implements InstallmentRepository {
  constructor(private readonly rows: readonly InstallmentRow[]) {}

  listRows(_scope: AccessScope, cardId?: string): Promise<InstallmentRow[]> {
    return Promise.resolve(
      this.rows.filter((row) => cardId === undefined || row.cardId === cardId),
    );
  }

  create(): never {
    return readOnly();
  }
  listPurchases(): never {
    return readOnly();
  }
  findPurchase(): never {
    return readOnly();
  }
  updatePurchase(): never {
    return readOnly();
  }
  removeInstallments(): never {
    return readOnly();
  }
  cardHasPurchases(): never {
    return readOnly();
  }
}

/**
 * Stored statements of every card, read without creating any (spec D9): the cards, one read of all
 * the installment rows, then per card its statements, daily purchases and received payments.
 */
export class DrizzleCardStatementSource implements CardStatementSource {
  private readonly cards: DrizzleCreditCardRepository;
  private readonly installments: DrizzleInstallmentRepository;

  constructor(private readonly deps: CardStatementSourceDependencies) {
    this.cards = new DrizzleCreditCardRepository(deps.db);
    this.installments = new DrizzleInstallmentRepository(deps.db);
  }

  async dueStatements(
    scope: AccessScope,
    today: string,
    timeZone: string,
  ): Promise<DueStatement[]> {
    const cards = await this.cards.list(scope);
    if (cards.length === 0) return [];
    const viewDeps = {
      purchases: this.deps.purchases,
      cardPayments: this.deps.cardPayments,
      installments: new PreloadedInstallments(await this.installments.listRows(scope)),
    };
    const horizon = addDays(today, AGENDA_UPCOMING_DAYS);
    const perCard = await Promise.all(
      cards.map(async (card) => {
        const statements = await this.cards.listStatements(scope, card.id);
        const views = await buildStatementViews(viewDeps, scope, card, statements, timeZone, today);
        return views.flatMap((view): DueStatement[] => {
          const owed = {
            ARS: unpaidRemainder(view.totals.ARS, view.payments?.ARS.paid ?? 0n),
            USD: unpaidRemainder(view.totals.USD, view.payments?.USD.paid ?? 0n),
          };
          if (view.dueDate > horizon || (owed.ARS <= 0n && owed.USD <= 0n)) return [];
          return [
            {
              cardId: card.id,
              cardName: card.name,
              statementId: view.id,
              dueDate: view.dueDate,
              closed: view.status === 'closed',
              owed,
            },
          ];
        });
      }),
    );
    return perCard.flat();
  }
}
