// The only file of the recurring module that imports another module. drizzle-kit needs the
// relations resolved to declare foreign keys, so they are re-exported from their owners' files.
export { users } from '../../../identity/infrastructure/db/schema';
export { accounts } from '../../../accounts/infrastructure/db/schema';
export { categories } from '../../../categories/infrastructure/db/schema';
