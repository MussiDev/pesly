ALTER TABLE "notices" DROP CONSTRAINT "notices_kind_payment_due_unique";--> statement-breakpoint
ALTER TABLE "notices" DROP CONSTRAINT "notices_kind_check";--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_owner_kind_payment_due_unique" UNIQUE("owner_id","kind","payment_id","due_date");--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_group_id_check" CHECK (("notices"."kind" in ('group_expense', 'group_settlement')) = ("notices"."group_id" is not null));--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('reminder', 'recorded', 'not_recorded', 'card_statement_due', 'budget_alert', 'group_expense', 'group_settlement'));