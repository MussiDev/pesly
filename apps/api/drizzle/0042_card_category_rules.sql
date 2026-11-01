CREATE TABLE "card_category_rules" (
	"owner_id" uuid NOT NULL,
	"merchant_key" text NOT NULL,
	"category_id" uuid NOT NULL,
	"category_kind" text DEFAULT 'expense' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_category_rules_pk" PRIMARY KEY("owner_id","merchant_key"),
	CONSTRAINT "card_category_rules_merchant_key_check" CHECK (char_length("card_category_rules"."merchant_key") between 1 and 80),
	CONSTRAINT "card_category_rules_category_kind_check" CHECK ("card_category_rules"."category_kind" = 'expense')
);
--> statement-breakpoint
ALTER TABLE "card_category_rules" ADD CONSTRAINT "card_category_rules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_category_rules" ADD CONSTRAINT "card_category_rules_category_owner_kind_fk" FOREIGN KEY ("category_id","owner_id","category_kind") REFERENCES "public"."categories"("id","owner_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_category_rules_category_idx" ON "card_category_rules" USING btree ("category_id");