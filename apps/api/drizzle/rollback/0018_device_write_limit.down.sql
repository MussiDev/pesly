-- Reverse of 0018_device_write_limit.sql. DESTRUCTIVE only for counters: it deletes the rows of the
-- `device` bucket, a minute of limit history per user, and nothing else. No movement, account,
-- category or user row is touched; the manual counters keep their count.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert rows
-- mid-script and make it wait on their locks), run this script, then revert the commit that added
-- the migration. Apply it BEFORE the rollback of any older migration (newest `when` first): its
-- journal `when` is the greatest, and drizzle only applies migrations newer than the last recorded.
-- Run it as a whole (psql -1 -f) so it applies atomically.

-- A DO block with a column check so the script also runs when the table is already gone (the
-- rollbacks of older migrations drop it) and so a second run finds nothing to delete.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'movement_rate_limits' AND column_name = 'bucket'
  ) THEN
    DELETE FROM "movement_rate_limits" WHERE "bucket" <> 'manual';
  END IF;
END $$;

-- IF EXISTS on the table and every object: the migration tests re-run rollbacks out of order.
ALTER TABLE IF EXISTS "movement_rate_limits" DROP CONSTRAINT IF EXISTS "movement_rate_limits_bucket_check";
ALTER TABLE IF EXISTS "movement_rate_limits" DROP CONSTRAINT IF EXISTS "movement_rate_limits_owner_id_bucket_window_start_pk";
ALTER TABLE IF EXISTS "movement_rate_limits" DROP COLUMN IF EXISTS "bucket";

-- The original key, added only when the table exists and has no key yet, so a second run keeps it.
DO $$
BEGIN
  IF to_regclass('public.movement_rate_limits') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.movement_rate_limits') AND contype = 'p'
  ) THEN
    ALTER TABLE "movement_rate_limits" ADD CONSTRAINT "movement_rate_limits_owner_id_window_start_pk" PRIMARY KEY ("owner_id", "window_start");
  END IF;
END $$;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0018_device_write_limit.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791162359112;
