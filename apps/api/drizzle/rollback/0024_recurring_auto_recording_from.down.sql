-- Reverse of 0024_recurring_auto_recording_from.sql. Drops `recurring_payments.auto_recording_from`,
-- so the start day of the automatic recording is lost; the change is otherwise additive and no
-- other data is touched.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0023 (newest `when` first).

ALTER TABLE "recurring_payments" DROP COLUMN IF EXISTS "auto_recording_from";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0024_recurring_auto_recording_from.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791585171427;
