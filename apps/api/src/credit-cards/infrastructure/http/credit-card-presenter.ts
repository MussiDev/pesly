import type {
  CardExpenseResponse,
  CreditCardResponse,
  InstallmentExpensesResponse,
  InstallmentPurchaseResponse,
  ListInstallmentPurchasesResponse,
  StatementPaymentResponse,
  StatementResponse,
} from '@pesly/shared';
import type { InstallmentPurchaseList } from '../../application/list-installment-purchases';
import type { RecordedCardExpense } from '../../application/record-card-expense';
import type { RecordedStatementPayment } from '../../application/record-statement-payment';
import type { CreditCard, StatementView } from '../../domain/credit-card';
import type { InstallmentPurchaseView, MonthlyInstallmentExpense } from '../../domain/installment';

export function presentCreditCard(card: CreditCard): CreditCardResponse {
  return {
    id: card.id,
    name: card.name,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    arsAccountId: card.arsAccountId,
    usdAccountId: card.usdAccountId,
    createdAt: card.createdAt.toISOString(),
  };
}

export function presentStatement(statement: StatementView): StatementResponse {
  return {
    id: statement.id,
    cardId: statement.cardId,
    period: statement.period,
    closingDate: statement.closingDate,
    dueDate: statement.dueDate,
    status: statement.status,
    totals: {
      ARS: statement.totals.ARS.toString(),
      USD: statement.totals.USD.toString(),
    },
    installments: statement.installments.map((installment) => ({
      purchaseId: installment.purchaseId,
      number: installment.number,
      count: installment.count,
      amount: installment.amount.toString(),
      categoryId: installment.categoryId,
    })),
    payments: statement.payments && {
      ARS: {
        paid: statement.payments.ARS.paid.toString(),
        status: statement.payments.ARS.status,
      },
      USD: {
        paid: statement.payments.USD.paid.toString(),
        status: statement.payments.USD.status,
      },
    },
  };
}

export function presentStatementPayment(
  payment: RecordedStatementPayment,
): StatementPaymentResponse {
  return {
    movementId: payment.movementId,
    sourceAccountId: payment.sourceAccountId,
    accountId: payment.accountId,
    currency: payment.currency,
    amount: payment.amount.toString(),
    exchange: payment.exchange && {
      pesosAmount: payment.exchange.pesosAmount.toString(),
      rate: payment.exchange.rate.toString(),
    },
    occurredAt: payment.occurredAt.toISOString(),
  };
}

export function presentCardExpense(expense: RecordedCardExpense): CardExpenseResponse {
  return {
    movementId: expense.movementId,
    accountId: expense.accountId,
    currency: expense.currency,
    amount: expense.amount.toString(),
    occurredAt: expense.occurredAt.toISOString(),
    statementId: expense.statementId,
  };
}

export function presentInstallmentPurchase(
  purchase: InstallmentPurchaseView,
): InstallmentPurchaseResponse {
  return {
    id: purchase.id,
    cardId: purchase.cardId,
    categoryId: purchase.categoryId,
    amount: purchase.totalAmount.toString(),
    currency: 'ARS',
    installmentCount: purchase.installmentCount,
    purchasedOn: purchase.purchasedOn,
    note: purchase.note,
    createdAt: purchase.createdAt.toISOString(),
    installments: purchase.installments.map((installment) => ({
      number: installment.number,
      amount: installment.amount.toString(),
      period: installment.period,
      closingDate: installment.closingDate,
      dueDate: installment.dueDate,
      status: installment.status,
    })),
  };
}

export function presentInstallmentPurchaseList(
  list: InstallmentPurchaseList,
): ListInstallmentPurchasesResponse {
  return {
    items: list.items.map(presentInstallmentPurchase),
    pendingDebt: { ARS: list.pendingDebt.ARS.toString(), USD: list.pendingDebt.USD.toString() },
  };
}

export function presentInstallmentExpenses(
  items: MonthlyInstallmentExpense[],
): InstallmentExpensesResponse {
  return {
    items: items.map((item) => ({
      month: item.month,
      categoryId: item.categoryId,
      currency: 'ARS',
      amount: item.amount.toString(),
    })),
  };
}
