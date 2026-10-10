import type { Database } from '../shared/db/client';
import { DrizzleCardAccountLinks } from './infrastructure/db/drizzle-card-account-links';

export * from './infrastructure/http/credit-card-routes';
export { createInstallmentCategoryUsage } from './infrastructure/db/drizzle-installment-category-usage';
export { eraseUserCreditCards } from './infrastructure/db/erase-user-credit-cards';

/** The accounts module's `AccountLinks` port, answered from the cards table (spec D2). */
export function createCardAccountLinks(db: Database): DrizzleCardAccountLinks {
  return new DrizzleCardAccountLinks(db);
}
