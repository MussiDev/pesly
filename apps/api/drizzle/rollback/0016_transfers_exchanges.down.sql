-- Reverse of 0016_transfers_exchanges.sql. DESTRUCTIVE for transfers and exchanges only: it deletes
-- every row of type 'transfer' and 'exchange' of every user (they cannot exist without the
-- destination columns), so after it balances no longer include them. Expense and income rows,
-- accounts, categories and every other table are untouched.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert rows
-- mid-script and make it wait on their locks), run this script, then revert the commit that added
-- the migration. Apply it BEFORE 0014_movements.down.sql and before the rollback of any older
-- migration (newest `when` first): drizzle only applies migrations newer than the last recorded.
-- Run it as a whole (psql -1 -f) so it applies atomically.

-- A DO block so the script also runs when `movements` is already gone (the rollbacks of older
-- migrations drop it) and so a second run finds nothing to delete.
DO $$
BEGIN
  IF to_regclass('public.movements') IS NOT NULL THEN
    DELETE FROM "movements" WHERE "type" IN ('transfer', 'exchange');
  END IF;
END $$;

-- IF EXISTS on the table and every object: the migration tests re-run rollbacks out of order.
ALTER TABLE IF EXISTS "movements" DROP CONSTRAINT IF EXISTS "movements_shape_check";
ALTER TABLE IF EXISTS "movements" DROP CONSTRAINT IF EXISTS "movements_destination_amount_range_check";
ALTER TABLE IF EXISTS "movements" DROP CONSTRAINT IF EXISTS "movements_destination_differs_check";
ALTER TABLE IF EXISTS "movements" DROP CONSTRAINT IF EXISTS "movements_destination_owner_fk";
DROP INDEX IF EXISTS "movements_destination_idx";
ALTER TABLE IF EXISTS "movements" DROP COLUMN IF EXISTS "destination_account_id";
ALTER TABLE IF EXISTS "movements" DROP COLUMN IF EXISTS "destination_amount";

-- Only expense and income rows are left, and all of them have these values.
ALTER TABLE IF EXISTS "movements" ALTER COLUMN "category_id" SET NOT NULL;
ALTER TABLE IF EXISTS "movements" ALTER COLUMN "rate" SET NOT NULL;
ALTER TABLE IF EXISTS "movements" ALTER COLUMN "rate_source" SET NOT NULL;

-- The two original checks, dropped first so a second run replaces them instead of failing.
ALTER TABLE IF EXISTS "movements" DROP CONSTRAINT IF EXISTS "movements_type_check";
ALTER TABLE IF EXISTS "movements" DROP CONSTRAINT IF EXISTS "movements_rate_source_check";
ALTER TABLE IF EXISTS "movements" ADD CONSTRAINT "movements_type_check" CHECK ("movements"."type" in ('expense', 'income'));
ALTER TABLE IF EXISTS "movements" ADD CONSTRAINT "movements_rate_source_check" CHECK ("movements"."rate_source" in ('automatic', 'manual'));

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0016_transfers_exchanges.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790991879498;
