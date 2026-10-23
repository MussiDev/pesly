-- Reverse of 0041_group_notices.sql. Deletes the `group_expense` and `group_settlement` notices
-- (their push deliveries go with them through the foreign key), drops `notices.group_id` and its
-- check, and restores the previous kind check and the unique key without the owner. Only the group
-- notices are lost; the expenses and settlements they pointed at are untouched.
-- Rollback plan: take a backup first, stop the API and the worker (a running API can insert a group
-- notice mid-script), run this script as a whole (psql -1 -f), then revert the commit that added the
-- migration. Apply it BEFORE the rollback of 0040 (newest `when` first). Safe to run twice.

DO $$
BEGIN
  IF to_regclass('public.notices') IS NOT NULL THEN
    DELETE FROM "notices" WHERE "kind" in ('group_expense', 'group_settlement');
    ALTER TABLE "notices" DROP CONSTRAINT IF EXISTS "notices_group_id_check";
    ALTER TABLE "notices" DROP COLUMN IF EXISTS "group_id";
    ALTER TABLE "notices" DROP CONSTRAINT IF EXISTS "notices_kind_check";
    ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('reminder', 'recorded', 'not_recorded', 'card_statement_due', 'budget_alert'));
    ALTER TABLE "notices" DROP CONSTRAINT IF EXISTS "notices_owner_kind_payment_due_unique";
    ALTER TABLE "notices" DROP CONSTRAINT IF EXISTS "notices_kind_payment_due_unique";
    ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_payment_due_unique" UNIQUE("kind","payment_id","due_date");
  END IF;
END $$;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0041_group_notices.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792780077683;
