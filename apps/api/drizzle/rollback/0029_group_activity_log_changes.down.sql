-- Reverse of 0029_group_activity_log_changes.sql. Drops the immutability trigger and its function,
-- deletes the log rows of the four actions it added (expense_updated, expense_deleted,
-- settlement_updated, settlement_deleted), drops the `before` and `after` columns and the snapshot
-- check, and restores the action check of 0028. The change history is lost; creation rows stay.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0028 (newest `when` first).

DROP TRIGGER IF EXISTS "group_activity_log_immutable" ON "group_activity_log";
DROP FUNCTION IF EXISTS "group_activity_log_immutable"();

-- The table belongs to an older migration; when its own rollback already ran there is nothing to restore.
DO $$
BEGIN
  IF to_regclass('public.group_activity_log') IS NOT NULL THEN
    DELETE FROM "group_activity_log"
     WHERE "action" IN ('expense_updated', 'expense_deleted', 'settlement_updated', 'settlement_deleted');
    ALTER TABLE "group_activity_log" DROP CONSTRAINT IF EXISTS "group_activity_log_snapshots_check";
    ALTER TABLE "group_activity_log" DROP CONSTRAINT IF EXISTS "group_activity_log_action_check";
    ALTER TABLE "group_activity_log" DROP COLUMN IF EXISTS "before";
    ALTER TABLE "group_activity_log" DROP COLUMN IF EXISTS "after";
    ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_action_check" CHECK ("group_activity_log"."action" in ('expense_created', 'settlement_created'));
  END IF;
END $$;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0029_group_activity_log_changes.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791678105362;
