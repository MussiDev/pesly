-- Reverse of 0034_budgets.sql. Drops the four budget tables, so every budget, version, category
-- selection and threshold is lost; nothing else is touched (the categories and users stay).
-- Rollback plan: take a backup first, stop the API, run this script as a whole (psql -1 -f), then
-- revert the commit that added the migration. Apply it BEFORE the rollbacks of older migrations
-- (newest `when` first). Idempotent.

DROP TABLE IF EXISTS "budget_version_thresholds";
DROP TABLE IF EXISTS "budget_version_categories";
DROP TABLE IF EXISTS "budget_versions";
DROP TABLE IF EXISTS "budgets";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0034_budgets.
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791770000000;
  END IF;
END
$$;
