-- Reverse of 0023_recurring_payments.sql. DESTRUCTIVE: drops the recurring payments and their
-- occurrences, so every payment rule and the history of confirmed or skipped occurrences is lost.
-- Expenses already recorded as movements are not touched: nothing references these tables and
-- `movement_id` has no foreign key.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0022 (newest `when` first).

DROP TABLE IF EXISTS "recurring_occurrences";
DROP TABLE IF EXISTS "recurring_payments";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0023_recurring_payments.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791563194787;
