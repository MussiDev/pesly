ALTER TABLE "credit_cards" ADD COLUMN "reminder_days" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_reminder_days_check" CHECK ("credit_cards"."reminder_days" between 0 and 30);--> statement-breakpoint
ALTER TABLE "notices" DROP CONSTRAINT "notices_kind_check";--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('reminder', 'recorded', 'not_recorded', 'card_statement_due'));
