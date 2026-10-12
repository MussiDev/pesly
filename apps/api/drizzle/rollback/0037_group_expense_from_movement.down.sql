-- Reverse of 0037_group_expense_from_movement.sql. Detaches every adopted expense first, so code from
-- before this ticket can never delete a personal movement through the payer-movement recorder. The
-- budgets then count that movement fully and the share again until the expense is deleted. Then drops
-- the two checks, the three columns and the unique index, and recreates the plain index of 0035.
-- Rollback plan: take a backup, stop the API and the worker, run this script as a whole (psql -1 -f),
-- then revert the commit that added the migration. Apply it BEFORE the rollbacks of older migrations
-- (newest `when` first). Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'group_expenses' AND column_name = 'adopted_movement'
  ) THEN
    UPDATE "group_expenses" SET "payer_movement_id" = NULL WHERE "adopted_movement";
  END IF;
END
$$;

ALTER TABLE "group_activity_log" DROP CONSTRAINT IF EXISTS "group_activity_log_auto_category_check";
ALTER TABLE "group_activity_log" DROP CONSTRAINT IF EXISTS "group_activity_log_from_movement_check";
ALTER TABLE "group_activity_log" DROP COLUMN IF EXISTS "auto_category";
ALTER TABLE "group_activity_log" DROP COLUMN IF EXISTS "from_movement";
ALTER TABLE "group_expenses" DROP COLUMN IF EXISTS "adopted_movement";

DROP INDEX IF EXISTS "group_expenses_payer_movement_unique";
CREATE INDEX IF NOT EXISTS "group_expenses_payer_movement_idx" ON "group_expenses" USING btree ("payer_movement_id") WHERE "group_expenses"."payer_movement_id" is not null;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0037_group_expense_from_movement.
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791810000000;
  END IF;
END
$$;
