-- Reverse of 0037_exchange_rate_history.sql. Drops `exchange_rate_history`, so every stored daily
-- rate is lost (the current rates in `exchange_rates` are untouched) and the net worth report of a
-- past month has no rate until the history is written again; nothing else is touched.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0036 (newest `when` first).

DROP TABLE IF EXISTS "exchange_rate_history";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0037_exchange_rate_history.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791810000000;
