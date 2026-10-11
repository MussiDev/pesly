-- Reverse of 0032_card_statement_reminders.sql. Deletes every `card_statement_due` notice (the
-- restored check would refuse them), restores the previous `notices_kind_check`, and drops
-- `credit_cards.reminder_days` with its check, so every card's reminder setting is lost; nothing
-- else is touched. Notices of the other kinds stay.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0031 (newest `when` first).

-- Guarded so the script also runs after the rollback of 0025 has dropped `notices`.
DO $$
BEGIN
  IF to_regclass('public.notices') IS NOT NULL THEN
    DELETE FROM "notices" WHERE "kind" = 'card_statement_due';
    ALTER TABLE "notices" DROP CONSTRAINT IF EXISTS "notices_kind_check";
    ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('reminder', 'recorded', 'not_recorded'));
  END IF;
END
$$;

ALTER TABLE IF EXISTS "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_reminder_days_check";
ALTER TABLE IF EXISTS "credit_cards" DROP COLUMN IF EXISTS "reminder_days";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0032_card_statement_reminders.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791760600000;
