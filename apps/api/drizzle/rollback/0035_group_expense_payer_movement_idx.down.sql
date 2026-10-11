-- Reverse of 0035_group_expense_payer_movement_idx.sql. Drops the partial index only; no table,
-- column or row changes, so nothing is lost and the budget spending read just gets slower.
-- Rollback plan: stop the API, run this script as a whole (psql -1 -f), then revert the commit
-- that added the migration. Apply it BEFORE the rollbacks of older migrations (newest `when`
-- first). Idempotent.

DROP INDEX IF EXISTS "group_expenses_payer_movement_idx";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0035_group_expense_payer_movement_idx.
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791790000000;
  END IF;
END
$$;
