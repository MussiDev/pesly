import type { InstallmentCurrency } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { CreditCard } from '../domain/credit-card';
import { InstallmentPurchaseDateInFuture, InvalidFirstPeriod } from '../domain/errors';
import {
  planInstallments,
  viewPurchase,
  type InstallmentPurchaseView,
} from '../domain/installment';
import { assignStatement } from '../domain/statement-assignment';
import { zoneAndToday, type CreditCardDependencies } from './dependencies';
import { ensureStatements } from './ensure-statements';

export interface InstallmentPurchaseInput {
  categoryId: string;
  currency: InstallmentCurrency;
  /** Total in minor units of `currency`. */
  amount: bigint;
  installments: number;
  /** Calendar day of the purchase in the user's time zone, `YYYY-MM-DD`. */
  purchasedOn: string;
  note?: string;
  /**
   * The period (`YYYY-MM`) of installment 1, instead of the statement of the purchase day. The
   * statement import uses it to land an installment N on the statement being imported.
   */
  firstPeriod?: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateInstallmentPurchase {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'timeZones' | 'clock' | 'installments' | 'categories' | 'writeLimit'
    >,
  ) {}

  /**
   * Records the purchase and spreads it over the card's statements, the first installment in the
   * statement of the purchase day and each following one in the next (FR-01, FR-03, FR-04).
   * Missing or foreign card: `ResourceNotFound`, before anything is stored. The creation unit of
   * the write limit is refunded when anything fails.
   */
  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    input: InstallmentPurchaseInput,
  ): Promise<InstallmentPurchaseView> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const unit = await this.deps.writeLimit.take(scope);
    try {
      return await this.store(scope, card, input);
    } catch (error) {
      await unit.release();
      throw error;
    }
  }

  /**
   * The same creation without spending a unit of the write limit: only for the statement import,
   * which takes one unit for the whole request.
   */
  async createUnmetered(
    scope: AccessScope<'write'>,
    cardId: string,
    input: InstallmentPurchaseInput,
  ): Promise<InstallmentPurchaseView> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    return this.store(scope, card, input);
  }

  private async store(
    scope: AccessScope<'write'>,
    card: CreditCard,
    input: InstallmentPurchaseInput,
  ): Promise<InstallmentPurchaseView> {
    if (input.firstPeriod !== undefined && !PERIOD.test(input.firstPeriod)) {
      throw new InvalidFirstPeriod();
    }
    await this.deps.categories.assertOpenExpenseCategory(scope, input.categoryId);
    const { today } = await zoneAndToday(this.deps, scope.userId);
    if (input.purchasedOn > today) throw new InstallmentPurchaseDateInFuture();

    const statements = await ensureStatements(this.deps.cards, scope, card, today);
    let firstPeriod = input.firstPeriod;
    if (firstPeriod === undefined) {
      // The cycles up to the one open today exist, so a purchase dated up to today has one.
      const first = assignStatement(input.purchasedOn, statements) ?? statements.at(-1);
      if (!first) throw new Error('A card always has a statement after ensureStatements');
      firstPeriod = first.period;
    }

    const purchase = await this.deps.installments.create(scope, {
      cardId: card.id,
      categoryId: input.categoryId,
      totalAmount: input.amount,
      currency: input.currency,
      purchasedOn: input.purchasedOn,
      note: input.note ?? null,
      installments: planInstallments(input.amount, input.installments, firstPeriod),
    });
    return viewPurchase(purchase, statements, card, today);
  }
}
