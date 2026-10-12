-- Reverse of 0036_budget_alert_marks.sql. Deletes every `budget_alert` notice (the restored check
-- would refuse them), restores the previous `notices_kind_check`, and drops `budget_alert_marks`,
-- so every alert mark is lost and the thresholds alert again after a re-apply; nothing else is
-- touched. Notices of the other kinds stay.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0035 (newest `when` first).

-- Guarded so the script also runs after the rollback of 0025 has dropped `notices`.
DO $$
BEGIN
  IF to_regclass('public.notices') IS NOT NULL THEN
    DELETE FROM "notices" WHERE "kind" = 'budget_alert';
    ALTER TABLE "notices" DROP CONSTRAINT IF EXISTS "notices_kind_check";
    ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('reminder', 'recorded', 'not_recorded', 'card_statement_due'));
  END IF;
END
$$;

DROP TABLE IF EXISTS "budget_alert_marks";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0036_budget_alert_marks.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791800000000;
