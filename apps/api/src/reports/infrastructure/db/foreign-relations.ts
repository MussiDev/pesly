// The only file of the reports module that imports another module's tables; every one is read-only.
export { users } from '../../../identity/infrastructure/db/schema';
export { accounts } from '../../../accounts/infrastructure/db/schema';
export { tags } from '../../../movements/infrastructure/db/schema';
