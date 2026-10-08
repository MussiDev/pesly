-- Reverse of 0020_installments.sql. DESTRUCTIVE only for installment data: drops installments and
-- installment_purchases, so every installment purchase of every user is lost. Cards, statements,
-- categories and movements are not touched.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert rows
-- mid-script and make it wait on their locks), run this script, then revert the commit that added
-- the migration. Apply it BEFORE the rollback of any older migration (newest `when` first): its
-- journal `when` is the greatest, and drizzle only applies migrations newer than the last recorded.
-- Run it as a whole (psql -1 -f) so it applies atomically.

-- Installments go first: they reference installment_purchases. IF EXISTS keeps a second run, and the
-- migration tests that re-run rollbacks out of order, from failing.
DROP TABLE IF EXISTS "installments";
DROP TABLE IF EXISTS "installment_purchases";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0020_installments.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791419213992;
