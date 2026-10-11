ALTER TABLE "group_expenses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_version_check" CHECK ("group_expenses"."version" >= 1);--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_version_check" CHECK ("group_settlements"."version" >= 1);
