-- Reverse of 0019_credit_cards.sql. DESTRUCTIVE only for card data: drops credit_card_statements
-- and credit_cards, so every card and statement of every user is lost. The linked accounts are not
-- touched: they stay as plain credit card accounts and keep their movements.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert rows
-- mid-script and make it wait on their locks), run this script, then revert the commit that added
-- the migration. Apply it BEFORE the rollback of any older migration (newest `when` first): its
-- journal `when` is the greatest, and drizzle only applies migrations newer than the last recorded.
-- Run it as a whole (psql -1 -f) so it applies atomically.

-- Statements go first: their composite key depends on credit_cards. IF EXISTS keeps a second run,
-- and the migration tests that re-run rollbacks out of order, from failing.
DROP TABLE IF EXISTS "credit_card_statements";
DROP TABLE IF EXISTS "credit_cards";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0019_credit_cards.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791246865297;
