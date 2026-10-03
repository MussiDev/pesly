-- Reverse of 0017_tags.sql. DESTRUCTIVE only for tag data: drops tags and movement_tags, so every
-- tag and every movement-to-tag link of every user is lost. No movement, account, category or
-- user row is touched; the indexes and the unique constraint that 0017 added to movements are
-- removed.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert rows
-- mid-script and make it wait on their locks), run this script, then revert the commit that added
-- the migration. Apply it BEFORE the rollback of any older migration (newest `when` first): its
-- journal `when` is the greatest, and drizzle only applies migrations newer than the last recorded.
-- Run it as a whole (psql -1 -f) so it applies atomically.

-- The links go first: their composite keys depend on tags and on the movements constraint below.
DROP TABLE IF EXISTS "movement_tags";
DROP TABLE IF EXISTS "tags";

DROP INDEX IF EXISTS "movements_owner_account_date_idx";
DROP INDEX IF EXISTS "movements_owner_category_date_idx";
-- IF EXISTS on the table too: the migration tests re-run rollbacks after `movements` is gone.
ALTER TABLE IF EXISTS "movements" DROP CONSTRAINT IF EXISTS "movements_id_owner_unique";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0017_tags.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790992572883;
