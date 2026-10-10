CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notices_kind_payment_due_unique" UNIQUE("kind","payment_id","due_date"),
	CONSTRAINT "notices_kind_check" CHECK ("notices"."kind" in ('reminder', 'recorded', 'not_recorded')),
	CONSTRAINT "notices_text_length_check" CHECK (char_length("notices"."text") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD COLUMN "reminder_days" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_owner_created_idx" ON "notices" USING btree ("owner_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notices_owner_unread_idx" ON "notices" USING btree ("owner_id") WHERE "notices"."read_at" is null;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_reminder_days_check" CHECK ("recurring_payments"."reminder_days" between 0 and 30);