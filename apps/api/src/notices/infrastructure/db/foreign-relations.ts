// The only file of the notices module that imports another module. drizzle-kit needs the
// relation resolved to declare the foreign key, so it is re-exported from its owner's file.
export { users } from '../../../identity/infrastructure/db/schema';
