-- Reverse of 0027_card_automatic_debit.sql. Drops `card_automatic_debits`, so every claim row is
-- lost, and the four automatic debit columns of `credit_cards`, so every debit link is lost;
-- nothing else is touched. Transfers already recorded by the job are ordinary movements and stay.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0026 (newest `when` first).

DROP TABLE IF EXISTS "card_automatic_debits";

DROP INDEX IF EXISTS "credit_cards_automatic_debit_idx";
ALTER TABLE IF EXISTS "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_debit_ars_account_owner_fk";
ALTER TABLE IF EXISTS "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_debit_usd_account_owner_fk";
ALTER TABLE IF EXISTS "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_debit_ars_linked_check";
ALTER TABLE IF EXISTS "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_debit_usd_linked_check";
ALTER TABLE IF EXISTS "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_debit_ars_not_card_account_check";
ALTER TABLE IF EXISTS "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_debit_usd_not_card_account_check";
ALTER TABLE IF EXISTS "credit_cards" DROP COLUMN IF EXISTS "debit_ars_account_id";
ALTER TABLE IF EXISTS "credit_cards" DROP COLUMN IF EXISTS "debit_usd_account_id";
ALTER TABLE IF EXISTS "credit_cards" DROP COLUMN IF EXISTS "debit_ars_linked_on";
ALTER TABLE IF EXISTS "credit_cards" DROP COLUMN IF EXISTS "debit_usd_linked_on";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0027_card_automatic_debit.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791747000000;
