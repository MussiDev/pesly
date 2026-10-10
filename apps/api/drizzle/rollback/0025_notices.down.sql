-- Reverse of 0025_notices.sql. Drops the `notices` table, so every stored notice is lost, and
-- `recurring_payments.reminder_days`, so each payment's reminder setting is lost; nothing else is
-- touched.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0024 (newest `when` first).

DROP TABLE IF EXISTS "notices";

ALTER TABLE IF EXISTS "recurring_payments" DROP CONSTRAINT IF EXISTS "recurring_payments_reminder_days_check";
ALTER TABLE IF EXISTS "recurring_payments" DROP COLUMN IF EXISTS "reminder_days";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0025_notices.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791590000000;
