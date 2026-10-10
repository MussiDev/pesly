import type { AccessScope } from '../../shared/access';
import type { CreditCard, Statement, StatementView } from '../domain/credit-card';
import { addInstallmentTotals, installmentsOfPeriod } from '../domain/installment';
import { statementTotals } from '../domain/statement-assignment';
import { allocatePayments } from '../domain/statement-payment';
import { withStatus, type CreditCardDependencies } from './dependencies';

/**
 * The views of `statements` (ordered by closing date): totals of purchases and installments
 * (FR-03, FR-06) and, for the closed ones, the payments allocated to them (FR-02, spec D1).
 */
export async function buildStatementViews(
  deps: Pick<CreditCardDependencies, 'purchases' | 'installments' | 'cardPayments'>,
  scope: AccessScope,
  card: CreditCard,
  statements: readonly Statement[],
  timeZone: string,
  today: string,
): Promise<StatementView[]> {
  const daily = await deps.purchases.dailyPurchases(scope, card, timeZone);
  const rows = await deps.installments.listRows(scope, card.id);
  const received = await deps.cardPayments.receivedByCard(scope, card);
  const totals = statementTotals(statements, daily);
  addInstallmentTotals(totals, statements, rows);
  const views = statements.map((statement) =>
    withStatus(
      statement,
      today,
      totals.get(statement.id),
      installmentsOfPeriod(rows, statement.period),
    ),
  );
  const payments = allocatePayments(
    views.filter((view) => view.status === 'closed'),
    received,
  );
  return views.map((view) => ({ ...view, payments: payments.get(view.id) ?? null }));
}
