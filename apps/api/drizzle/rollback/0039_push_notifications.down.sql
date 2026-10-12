-- Reverse of 0039_push_notifications.sql. Drops `push_deliveries` and `push_subscriptions` (every
-- stored browser subscription is lost, so users must enable notifications again) and the column
-- `notices.push_handled_at` with its index; the notices themselves are untouched.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0038 (newest `when` first). Safe to run twice.

DROP TABLE IF EXISTS "push_deliveries";
DROP TABLE IF EXISTS "push_subscriptions";
DROP INDEX IF EXISTS "notices_push_unhandled_idx";
ALTER TABLE IF EXISTS "notices" DROP COLUMN IF EXISTS "push_handled_at";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0039_push_notifications.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791830000000;
