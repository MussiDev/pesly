-- Reverse of 0015_price_snapshots.sql. DESTRUCTIVE: drops the five tables of the crypto price job
-- and the daily snapshots, so every stored market price, the price refresh schedule and call
-- counter, the price failure log and every portfolio value snapshot of every user are lost.
-- Portfolios, holdings (and the prices already copied onto them), users and every other table are
-- untouched; only the holdings_crypto_ticker_idx index is dropped.
-- Rollback plan: run this script, then revert the commit that added the migration. Apply it before
-- 0013_investments.down.sql when rolling back further (newest first).
-- Run it as a whole (psql -1 -f) so it applies atomically, with the API and the worker stopped: a
-- running process can insert rows mid-script and make it wait on their locks.

DROP INDEX IF EXISTS "holdings_crypto_ticker_idx";
DROP TABLE IF EXISTS "portfolio_value_snapshots";
DROP TABLE IF EXISTS "crypto_market_prices";
DROP TABLE IF EXISTS "crypto_price_refresh_failures";
DROP TABLE IF EXISTS "crypto_price_usage";
DROP TABLE IF EXISTS "crypto_price_sync";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0015_price_snapshots.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790980568164;
