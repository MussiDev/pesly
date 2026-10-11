-- Reverse of 0031_group_record_version.sql. Drops the `version` column and its check from
-- `group_expenses` and `group_settlements`; every record version is lost, the rows stay.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0030 (group activity log changes) and the older ones (newest `when` first).

-- The tables belong to older migrations; when their own rollback already ran there is nothing to drop.
ALTER TABLE IF EXISTS "group_expenses" DROP CONSTRAINT IF EXISTS "group_expenses_version_check";
ALTER TABLE IF EXISTS "group_expenses" DROP COLUMN IF EXISTS "version";
ALTER TABLE IF EXISTS "group_settlements" DROP CONSTRAINT IF EXISTS "group_settlements_version_check";
ALTER TABLE IF EXISTS "group_settlements" DROP COLUMN IF EXISTS "version";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0031_group_record_version.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791760000000;
