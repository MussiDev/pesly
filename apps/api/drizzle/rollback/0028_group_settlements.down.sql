-- Reverse of 0028_group_settlements.sql. Drops the two settlement tables, the `settlement_created`
-- activity log rows and the `group_members.left_at` column, restores the unique index of
-- (group_id, user_id) and the activity log action check. Every stored settlement and leg is lost;
-- expenses, shares and members are not touched.
-- It REFUSES to run (raises an exception) while any member has `left_at` set: dropping the column
-- would bring back members who left, and the restored unique index could not hold a user who left
-- and joined again. Rejoin the members or delete their rows by hand first.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0027 (newest `when` first).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'group_members' AND column_name = 'left_at'
  ) THEN
    -- Nested so the second run, after the column is gone, never plans the query on it.
    IF EXISTS (SELECT 1 FROM "group_members" WHERE "left_at" IS NOT NULL) THEN
      RAISE EXCEPTION 'Cannot roll back 0028_group_settlements: some group members have left_at set';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "group_settlement_legs";
DROP TABLE IF EXISTS "group_settlements";

-- The tables below belong to older migrations; when their own rollback already ran they are gone
-- and these steps have nothing to restore.
DO $$
BEGIN
  IF to_regclass('public.group_activity_log') IS NOT NULL THEN
    DELETE FROM "group_activity_log" WHERE "action" = 'settlement_created';
    ALTER TABLE "group_activity_log" DROP CONSTRAINT IF EXISTS "group_activity_log_action_check";
    ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_action_check" CHECK ("group_activity_log"."action" in ('expense_created'));
  END IF;
END $$;

DROP INDEX IF EXISTS "group_members_group_active_idx";
DROP INDEX IF EXISTS "group_members_group_user_unique";
ALTER TABLE IF EXISTS "group_members" DROP COLUMN IF EXISTS "left_at";
DO $$
BEGIN
  IF to_regclass('public.group_members') IS NOT NULL THEN
    CREATE UNIQUE INDEX "group_members_group_user_unique" ON "group_members" USING btree ("group_id","user_id") WHERE "group_members"."user_id" is not null;
  END IF;
END $$;

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0028_group_settlements.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791670861757;
