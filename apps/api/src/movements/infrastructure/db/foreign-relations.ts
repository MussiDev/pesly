// The only file of the movements module that imports another module. drizzle-kit needs the
// relations resolved to declare foreign keys, so they are re-exported from their owners' files.
export { users } from '../../../identity/infrastructure/db/schema';
export { accounts } from '../../../accounts/infrastructure/db/schema';
export { categories } from '../../../categories/infrastructure/db/schema';
export { exchangeRates } from '../../../exchange-rates/infrastructure/db/schema';
// Read by the edit lock and the link read of the repository (DISC-001-05i D3, D4).
export { groupExpenses } from '../../../groups/infrastructure/db/schema';
