-- Reverse of 0033_savings_goals.sql. DESTRUCTIVE for goal data only: drops the goals and their
-- manual entries. Accounts, movements and every other table are not touched.
-- Rollback plan: take a backup first, stop the API, run this script as a whole (psql -1 -f), then
-- revert the commit that added the migration. Apply it BEFORE the rollback of 0032 (newest `when`
-- first).

DROP TABLE IF EXISTS "goal_entries";
DROP TABLE IF EXISTS "goals";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0033_savings_goals.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791770000000;
