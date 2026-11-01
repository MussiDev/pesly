-- Reverse of 0042_card_category_rules.sql. Drops the `card_category_rules` table: the merchant
-- categories the statement import learned (FEAT-016). No movement, purchase or category is touched;
-- only the suggestions learned so far are lost, and the import keeps working without them.
-- Rollback plan: take a backup first, stop the API (a running API can learn a rule mid-script), run
-- this script as a whole (psql -1 -f), then revert the commit that added the migration. Apply it
-- BEFORE the rollback of 0041 (newest `when` first). Safe to run twice.

DROP TABLE IF EXISTS "card_category_rules";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0042_card_category_rules.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793539459811;
