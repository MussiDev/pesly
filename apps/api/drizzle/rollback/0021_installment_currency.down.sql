-- Reverse of 0021_installment_currency.sql. DESTRUCTIVE only for USD installment purchases: the
-- currency column is dropped, so a purchase made in USD would read as ARS afterwards. Delete USD
-- installment purchases (or accept losing their currency) before running it.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0020 (newest `when` first).

ALTER TABLE IF EXISTS "installment_purchases" DROP CONSTRAINT IF EXISTS "installment_purchases_currency_check";
ALTER TABLE IF EXISTS "installment_purchases" DROP COLUMN IF EXISTS "currency";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0021_installment_currency.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791505000000;
