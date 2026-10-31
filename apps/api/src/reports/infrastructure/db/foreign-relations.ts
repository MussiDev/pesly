// The only file of the reports module that imports another module's tables; every one is read-only.
export { users } from '../../../identity/infrastructure/db/schema';
export { accounts } from '../../../accounts/infrastructure/db/schema';
export { movements, movementTags, tags } from '../../../movements/infrastructure/db/schema';
// Flow reads (DISC-001-09a Block 3).
export { categories } from '../../../categories/infrastructure/db/schema';
export {
  groups,
  groupCategories,
  groupExpenseShares,
  groupExpenses,
  groupMembers,
} from '../../../groups/infrastructure/db/schema';
export {
  creditCardStatements,
  creditCards,
  installmentPurchases,
  installments,
} from '../../../credit-cards/infrastructure/db/schema';
