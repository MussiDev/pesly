// The only file of the push module that imports another module. drizzle-kit needs the relations
// resolved to declare the foreign keys, so they are re-exported from their owners' files.
export { users } from '../../../identity/infrastructure/db/schema';
export { notices } from '../../../notices/infrastructure/db/schema';
