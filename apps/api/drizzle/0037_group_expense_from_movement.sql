DO $$
BEGIN
  -- Each creation records its own movement, so no movement can have two expenses; the unique index below
  -- would fail on one, so state it first and abort with a clear message (spec 05i D2).
  IF EXISTS (
    SELECT "payer_movement_id" FROM "group_expenses"
    WHERE "payer_movement_id" IS NOT NULL
    GROUP BY "payer_movement_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot add the unique movement link: a movement has more than one group expense';
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX "group_expenses_payer_movement_idx";--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD COLUMN "from_movement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD COLUMN "auto_category" text;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD COLUMN "adopted_movement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "group_expenses_payer_movement_unique" ON "group_expenses" USING btree ("payer_movement_id") WHERE "group_expenses"."payer_movement_id" is not null;--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_from_movement_check" CHECK ("group_activity_log"."from_movement" = false or "group_activity_log"."action" = 'expense_created');--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_auto_category_check" CHECK ("group_activity_log"."auto_category" is null or ("group_activity_log"."auto_category" in ('created', 'restored') and "group_activity_log"."action" = 'expense_created' and "group_activity_log"."from_movement"));