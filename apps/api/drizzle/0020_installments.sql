CREATE TABLE "installment_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"category_kind" text DEFAULT 'expense' NOT NULL,
	"total_amount" bigint NOT NULL,
	"installment_count" smallint NOT NULL,
	"purchased_on" date NOT NULL,
	"note" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_purchases_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "installment_purchases_total_range_check" CHECK ("installment_purchases"."total_amount" between 1 and 1000000000000000),
	CONSTRAINT "installment_purchases_count_check" CHECK ("installment_purchases"."installment_count" between 2 and 60),
	CONSTRAINT "installment_purchases_total_covers_count_check" CHECK ("installment_purchases"."total_amount" >= "installment_purchases"."installment_count"),
	CONSTRAINT "installment_purchases_category_kind_check" CHECK ("installment_purchases"."category_kind" = 'expense'),
	CONSTRAINT "installment_purchases_note_length_check" CHECK ("installment_purchases"."note" is null or char_length("installment_purchases"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"purchase_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"period" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "installments_pk" PRIMARY KEY("purchase_id","number"),
	CONSTRAINT "installments_number_check" CHECK ("installments"."number" between 1 and 60),
	CONSTRAINT "installments_period_check" CHECK ("installments"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "installments_amount_range_check" CHECK ("installments"."amount" between 1 and 1000000000000000)
);
--> statement-breakpoint
ALTER TABLE "installment_purchases" ADD CONSTRAINT "installment_purchases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchases" ADD CONSTRAINT "installment_purchases_card_owner_fk" FOREIGN KEY ("card_id","owner_id") REFERENCES "public"."credit_cards"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_purchases" ADD CONSTRAINT "installment_purchases_category_owner_kind_fk" FOREIGN KEY ("category_id","owner_id","category_kind") REFERENCES "public"."categories"("id","owner_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_purchase_owner_fk" FOREIGN KEY ("purchase_id","owner_id") REFERENCES "public"."installment_purchases"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installment_purchases_owner_card_idx" ON "installment_purchases" USING btree ("owner_id","card_id","created_at");--> statement-breakpoint
CREATE INDEX "installment_purchases_category_idx" ON "installment_purchases" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "installments_owner_idx" ON "installments" USING btree ("owner_id");