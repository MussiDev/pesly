CREATE TABLE "credit_card_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"period" text NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_statements_card_period_unique" UNIQUE("card_id","period"),
	CONSTRAINT "credit_card_statements_period_check" CHECK ("credit_card_statements"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "credit_card_statements_due_after_closing_check" CHECK ("credit_card_statements"."due_date" > "credit_card_statements"."closing_date")
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"ars_account_id" uuid NOT NULL,
	"usd_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_cards_ars_account_unique" UNIQUE("ars_account_id"),
	CONSTRAINT "credit_cards_usd_account_unique" UNIQUE("usd_account_id"),
	CONSTRAINT "credit_cards_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "credit_cards_name_length_check" CHECK (char_length("credit_cards"."name") between 1 and 46),
	CONSTRAINT "credit_cards_closing_day_check" CHECK ("credit_cards"."closing_day" between 1 and 31),
	CONSTRAINT "credit_cards_due_day_check" CHECK ("credit_cards"."due_day" between 1 and 31),
	CONSTRAINT "credit_cards_distinct_accounts_check" CHECK ("credit_cards"."ars_account_id" <> "credit_cards"."usd_account_id")
);
--> statement-breakpoint
ALTER TABLE "credit_card_statements" ADD CONSTRAINT "credit_card_statements_card_owner_fk" FOREIGN KEY ("card_id","owner_id") REFERENCES "public"."credit_cards"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_ars_account_owner_fk" FOREIGN KEY ("ars_account_id","owner_id") REFERENCES "public"."accounts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_usd_account_owner_fk" FOREIGN KEY ("usd_account_id","owner_id") REFERENCES "public"."accounts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_card_statements_owner_idx" ON "credit_card_statements" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "credit_card_statements_card_closing_idx" ON "credit_card_statements" USING btree ("card_id","closing_date");--> statement-breakpoint
CREATE INDEX "credit_cards_owner_created_idx" ON "credit_cards" USING btree ("owner_id","created_at","id");