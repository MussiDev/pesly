// The only file of the budgets module that imports another module. drizzle-kit needs the
// relations resolved to declare foreign keys, so they are re-exported from their owners' files.
export { users } from '../../../identity/infrastructure/db/schema';
export { categories } from '../../../categories/infrastructure/db/schema';
// Written by the alert store (DISC-001-06d): one notice per newly marked threshold.
export { notices } from '../../../notices/infrastructure/db/schema';
// Read-only sources of the spending read (DISC-001-06c D4, D5); this module writes none of them.
export { accounts } from '../../../accounts/infrastructure/db/schema';
export { movements } from '../../../movements/infrastructure/db/schema';
export {
  groupCategories,
  groupExpenseShares,
  groupExpenses,
  groupMembers,
} from '../../../groups/infrastructure/db/schema';
