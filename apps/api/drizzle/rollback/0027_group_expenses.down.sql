-- Reverse of 0027_group_expenses.sql. Drops the four group expense tables and the
-- `groups.default_split_mode` column, so every stored group expense, share, default split and
-- activity log entry is lost; nothing else is touched.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0026 (newest `when` first).

DROP TABLE IF EXISTS "group_activity_log";
DROP TABLE IF EXISTS "group_default_split_shares";
DROP TABLE IF EXISTS "group_expense_shares";
DROP TABLE IF EXISTS "group_expenses";
ALTER TABLE IF EXISTS "groups" DROP CONSTRAINT IF EXISTS "groups_default_split_mode_check";
ALTER TABLE IF EXISTS "groups" DROP COLUMN IF EXISTS "default_split_mode";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0027_group_expenses.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791667061357;
