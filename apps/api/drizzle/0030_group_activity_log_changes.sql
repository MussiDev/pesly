ALTER TABLE "group_activity_log" DROP CONSTRAINT "group_activity_log_action_check";--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_snapshots_check" CHECK (("group_activity_log"."action" in ('expense_updated', 'settlement_updated') and "group_activity_log"."before" is not null and "group_activity_log"."after" is not null) or ("group_activity_log"."action" in ('expense_deleted', 'settlement_deleted') and "group_activity_log"."before" is not null and "group_activity_log"."after" is null) or ("group_activity_log"."action" in ('expense_created', 'settlement_created') and "group_activity_log"."before" is null and "group_activity_log"."after" is null));--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_action_check" CHECK ("group_activity_log"."action" in ('expense_created', 'expense_updated', 'expense_deleted', 'settlement_created', 'settlement_updated', 'settlement_deleted'));--> statement-breakpoint
CREATE FUNCTION "group_activity_log_immutable"() RETURNS trigger AS $$
BEGIN
  -- A delete is allowed only as the cascade of deleting the group: by then the RI action runs after
  -- the group row is gone, so it is no longer visible here.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "groups" WHERE "id" = OLD."group_id") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'group_activity_log is immutable: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "group_activity_log_immutable" BEFORE UPDATE OR DELETE ON "group_activity_log" FOR EACH ROW EXECUTE FUNCTION "group_activity_log_immutable"();
