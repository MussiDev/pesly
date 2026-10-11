CREATE TABLE "card_automatic_debits" (
	"card_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"period" text NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_automatic_debits_pk" PRIMARY KEY("card_id","period","currency"),
	CONSTRAINT "card_automatic_debits_period_check" CHECK ("card_automatic_debits"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "card_automatic_debits_currency_check" CHECK ("card_automatic_debits"."currency" in ('ARS', 'USD')),
	CONSTRAINT "card_automatic_debits_status_check" CHECK ("card_automatic_debits"."status" in ('pending', 'recorded', 'skipped')),
	CONSTRAINT "card_automatic_debits_reason_check" CHECK ("card_automatic_debits"."reason" is null or "card_automatic_debits"."reason" in ('covered', 'account_unavailable', 'refused')),
	CONSTRAINT "card_automatic_debits_state_check" CHECK (("card_automatic_debits"."status" = 'recorded' and "card_automatic_debits"."movement_id" is not null and "card_automatic_debits"."reason" is null) or ("card_automatic_debits"."status" = 'skipped' and "card_automatic_debits"."movement_id" is null and "card_automatic_debits"."reason" is not null) or ("card_automatic_debits"."status" = 'pending' and "card_automatic_debits"."movement_id" is null and "card_automatic_debits"."reason" is null))
);
--> statement-breakpoint
ALTER TABLE "credit_cards" ADD COLUMN "debit_ars_account_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD COLUMN "debit_usd_account_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD COLUMN "debit_ars_linked_on" date;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD COLUMN "debit_usd_linked_on" date;--> statement-breakpoint
ALTER TABLE "card_automatic_debits" ADD CONSTRAINT "card_automatic_debits_card_owner_fk" FOREIGN KEY ("card_id","owner_id") REFERENCES "public"."credit_cards"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_automatic_debits_owner_idx" ON "card_automatic_debits" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_debit_ars_account_owner_fk" FOREIGN KEY ("debit_ars_account_id","owner_id") REFERENCES "public"."accounts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_debit_usd_account_owner_fk" FOREIGN KEY ("debit_usd_account_id","owner_id") REFERENCES "public"."accounts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_cards_automatic_debit_idx" ON "credit_cards" USING btree ("id") WHERE "credit_cards"."debit_ars_account_id" is not null or "credit_cards"."debit_usd_account_id" is not null;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_debit_ars_linked_check" CHECK (("credit_cards"."debit_ars_account_id" is null) = ("credit_cards"."debit_ars_linked_on" is null));--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_debit_usd_linked_check" CHECK (("credit_cards"."debit_usd_account_id" is null) = ("credit_cards"."debit_usd_linked_on" is null));--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_debit_ars_not_card_account_check" CHECK ("credit_cards"."debit_ars_account_id" is null or ("credit_cards"."debit_ars_account_id" <> "credit_cards"."ars_account_id" and "credit_cards"."debit_ars_account_id" <> "credit_cards"."usd_account_id"));--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_debit_usd_not_card_account_check" CHECK ("credit_cards"."debit_usd_account_id" is null or ("credit_cards"."debit_usd_account_id" <> "credit_cards"."ars_account_id" and "credit_cards"."debit_usd_account_id" <> "credit_cards"."usd_account_id"));