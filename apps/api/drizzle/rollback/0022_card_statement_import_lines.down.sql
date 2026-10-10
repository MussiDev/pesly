-- Reverse of 0022_card_statement_import_lines.sql. DESTRUCTIVE only for import bookkeeping: drops
-- the fingerprints of imported statement lines, so importing the same file again would create its
-- lines a second time. Purchases, installments and movements already created are not touched.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0021 (newest `when` first).

DROP TABLE IF EXISTS "card_statement_import_lines";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0022_card_statement_import_lines.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791510000000;
