-- Reverse of 0040_balance_adjustments.sql. Restores the previous `movements` checks: the type check
-- without 'adjustment', the amount range check `between 1 and 10^15` for every type, and the shape
-- check without the adjustment branch. No column or index was added, so none is dropped.
-- NOT DESTRUCTIVE: it REFUSES to run (raises, changes nothing) while any 'adjustment' row exists,
-- so a rollback can never silently delete balance history. Export or remove those rows first (a
-- deliberate decision of the operator), then run it again.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert an
-- adjustment mid-script), run this script as a whole (psql -1 -f), then revert the commit that
-- added the migration. Apply it BEFORE the rollback of 0039 (newest `when` first): drizzle only
-- applies migrations newer than the last recorded. Safe to run twice.

DO $$
BEGIN
  IF to_regclass('public.movements') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "movements" WHERE "type" = 'adjustment') THEN
      RAISE EXCEPTION 'Refusing to roll back 0040_balance_adjustments: adjustment rows exist in "movements"; export or remove them first';
    END IF;

    -- The shape check below needs the destination columns of 0016: when the rollback of 0016 already
    -- ran (an older rollback replayed twice), it left its own constraints and there is nothing to restore.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'movements' AND column_name = 'destination_account_id'
    ) THEN
    ALTER TABLE "movements" DROP CONSTRAINT IF EXISTS "movements_type_check";
    ALTER TABLE "movements" DROP CONSTRAINT IF EXISTS "movements_amount_range_check";
    ALTER TABLE "movements" DROP CONSTRAINT IF EXISTS "movements_shape_check";
    ALTER TABLE "movements" ADD CONSTRAINT "movements_type_check" CHECK ("movements"."type" in ('expense', 'income', 'transfer', 'exchange'));
    ALTER TABLE "movements" ADD CONSTRAINT "movements_amount_range_check" CHECK ("movements"."amount" between 1 and 1000000000000000);
    ALTER TABLE "movements" ADD CONSTRAINT "movements_shape_check" CHECK (("movements"."type" in ('expense', 'income') and "movements"."category_id" is not null and "movements"."rate" is not null and "movements"."rate_source" is not null and "movements"."rate_source" in ('automatic', 'manual') and "movements"."destination_account_id" is null and "movements"."destination_amount" is null) or ("movements"."type" = 'transfer' and "movements"."category_id" is null and "movements"."destination_account_id" is not null and "movements"."destination_amount" is not null and "movements"."destination_amount" = "movements"."amount" and "movements"."rate" is null and "movements"."rate_source" is null and "movements"."rate_type" is null) or ("movements"."type" = 'exchange' and "movements"."category_id" is null and "movements"."destination_account_id" is not null and "movements"."destination_amount" is not null and "movements"."rate" is not null and "movements"."rate_source" is not null and "movements"."rate_source" = 'implied' and "movements"."rate_type" is null));
    END IF;
  END IF;
END $$;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0040_balance_adjustments.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791937632948;
