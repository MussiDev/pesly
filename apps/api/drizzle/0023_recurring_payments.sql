CREATE TABLE "recurring_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirmed_amount" bigint,
	"movement_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_occurrences_payment_due_unique" UNIQUE("payment_id","due_date"),
	CONSTRAINT "recurring_occurrences_status_check" CHECK ("recurring_occurrences"."status" in ('pending', 'confirmed', 'skipped')),
	CONSTRAINT "recurring_occurrences_confirmed_amount_check" CHECK ("recurring_occurrences"."confirmed_amount" is null or "recurring_occurrences"."confirmed_amount" between 1 and 1000000000000000)
);
--> statement-breakpoint
CREATE TABLE "recurring_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"category_kind" text DEFAULT 'expense' NOT NULL,
	"frequency" text NOT NULL,
	"weekday" smallint,
	"day_of_month" smallint,
	"month" smallint,
	"start_date" date NOT NULL,
	"end_date" date,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"schedule_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_payments_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "recurring_payments_name_length_check" CHECK (char_length("recurring_payments"."name") between 1 and 80),
	CONSTRAINT "recurring_payments_amount_check" CHECK ("recurring_payments"."amount" between 1 and 1000000000000000),
	CONSTRAINT "recurring_payments_frequency_check" CHECK ("recurring_payments"."frequency" in ('weekly', 'monthly', 'yearly')),
	CONSTRAINT "recurring_payments_category_kind_check" CHECK ("recurring_payments"."category_kind" = 'expense'),
	CONSTRAINT "recurring_payments_weekday_check" CHECK ("recurring_payments"."weekday" between 0 and 6),
	CONSTRAINT "recurring_payments_day_of_month_check" CHECK ("recurring_payments"."day_of_month" between 1 and 31),
	CONSTRAINT "recurring_payments_month_check" CHECK ("recurring_payments"."month" between 1 and 12),
	CONSTRAINT "recurring_payments_mode_check" CHECK ("recurring_payments"."mode" in ('automatic', 'confirmation')),
	CONSTRAINT "recurring_payments_status_check" CHECK ("recurring_payments"."status" in ('active', 'paused')),
	CONSTRAINT "recurring_payments_end_after_start_check" CHECK ("recurring_payments"."end_date" is null or "recurring_payments"."end_date" >= "recurring_payments"."start_date")
);
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_payment_owner_fk" FOREIGN KEY ("payment_id","owner_id") REFERENCES "public"."recurring_payments"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_account_owner_fk" FOREIGN KEY ("account_id","owner_id") REFERENCES "public"."accounts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_category_owner_fk" FOREIGN KEY ("category_id","owner_id","category_kind") REFERENCES "public"."categories"("id","owner_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_occurrences_owner_status_due_idx" ON "recurring_occurrences" USING btree ("owner_id","status","due_date");--> statement-breakpoint
CREATE INDEX "recurring_payments_owner_status_idx" ON "recurring_payments" USING btree ("owner_id","status");