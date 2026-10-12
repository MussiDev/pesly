CREATE TABLE "budget_alert_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"month" date NOT NULL,
	"threshold" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_alert_marks_budget_month_threshold_unique" UNIQUE("budget_id","month","threshold"),
	CONSTRAINT "budget_alert_marks_threshold_check" CHECK ("budget_alert_marks"."threshold" between 1 and 200),
	CONSTRAINT "budget_alert_marks_month_check" CHECK (extract(day from "budget_alert_marks"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "notices" DROP CONSTRAINT "notices_kind_check";--> statement-breakpoint
ALTER TABLE "budget_alert_marks" ADD CONSTRAINT "budget_alert_marks_budget_owner_fk" FOREIGN KEY ("budget_id","owner_id") REFERENCES "public"."budgets"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('reminder', 'recorded', 'not_recorded', 'card_statement_due', 'budget_alert'));