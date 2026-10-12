import type { Database } from '../shared/db/client';
import { DrizzleCardAccountLinks } from './infrastructure/db/drizzle-card-account-links';

export * from './infrastructure/http/credit-card-routes';
export { createInstallmentCategoryUsage } from './infrastructure/db/drizzle-installment-category-usage';
export { eraseUserCreditCards } from './infrastructure/db/erase-user-credit-cards';
export { buildStatementViews } from './application/statement-views';
export { unpaidRemainder } from './domain/automatic-debit';
export { owesStatement } from './domain/statement-reminder';
export type { StatementView } from './domain/credit-card';
export type { InstallmentRow } from './domain/installment';
export type { CardPayments } from './application/ports/card-payments';
export type { CardPurchases } from './application/ports/card-purchases';
export type { InstallmentRepository } from './application/ports/installment-repository';
export { DrizzleCreditCardRepository } from './infrastructure/db/drizzle-credit-card-repository';
export { DrizzleInstallmentRepository } from './infrastructure/db/drizzle-installment-repository';

/** The accounts module's `AccountLinks` port, answered from the cards table (spec D2). */
export function createCardAccountLinks(db: Database): DrizzleCardAccountLinks {
  return new DrizzleCardAccountLinks(db);
}
