import type { AccessScope } from '../../shared/access';
import type { CreditCard, Statement } from '../domain/credit-card';
import { monthlyInstallmentExpenses, type MonthlyInstallmentExpense } from '../domain/installment';
import type { CreditCardDependencies } from './dependencies';

export class ListInstallmentExpenses {
  constructor(private readonly deps: Pick<CreditCardDependencies, 'cards' | 'installments'>) {}

  /**
   * The caller's installments added up by the due-date month of their statement and by category
   * (FR-05): what budgets (PRD 06) and reports (PRD 09) read. `from` and `to` are `YYYY-MM`,
   * inclusive. Each installment counts alone: the purchase itself is never an expense.
   */
  async execute(
    scope: AccessScope,
    range: { from: string; to: string },
  ): Promise<MonthlyInstallmentExpense[]> {
    const [cards, rows] = await Promise.all([
      this.deps.cards.list(scope),
      this.deps.installments.listRows(scope),
    ]);
    const byCard = new Map<string, { card: CreditCard; statements: Statement[] }>();
    for (const card of cards) {
      byCard.set(card.id, {
        card,
        statements: await this.deps.cards.listStatements(scope, card.id),
      });
    }
    return monthlyInstallmentExpenses(rows, byCard, range);
  }
}
