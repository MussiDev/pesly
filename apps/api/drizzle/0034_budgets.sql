CREATE TABLE "budget_version_categories" (
	"version_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"kind" text DEFAULT 'expense' NOT NULL,
	CONSTRAINT "budget_version_categories_pkey" PRIMARY KEY("version_id","category_id"),
	CONSTRAINT "budget_version_categories_kind_check" CHECK ("budget_version_categories"."kind" = 'expense')
);
--> statement-breakpoint
CREATE TABLE "budget_version_thresholds" (
	"version_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"percent" smallint NOT NULL,
	CONSTRAINT "budget_version_thresholds_pkey" PRIMARY KEY("version_id","percent"),
	CONSTRAINT "budget_version_thresholds_percent_check" CHECK ("budget_version_thresholds"."percent" between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "budget_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_versions_budget_effective_unique" UNIQUE("budget_id","effective_from"),
	CONSTRAINT "budget_versions_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "budget_versions_effective_from_check" CHECK (extract(day from "budget_versions"."effective_from") = 1),
	CONSTRAINT "budget_versions_name_length_check" CHECK (char_length("budget_versions"."name") between 1 and 50),
	CONSTRAINT "budget_versions_amount_check" CHECK ("budget_versions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "budgets_currency_check" CHECK ("budgets"."currency" in ('ARS', 'USD'))
);
--> statement-breakpoint
ALTER TABLE "budget_version_categories" ADD CONSTRAINT "budget_version_categories_version_owner_fk" FOREIGN KEY ("version_id","owner_id") REFERENCES "public"."budget_versions"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Deferred (written by hand; drizzle-kit does not model it): deleting a user cascades to its categories
-- and to its budgets in separate internal statements, and an immediate check would see the category
-- deleted while a budget still references it. Deleting a category a budget uses still fails.
ALTER TABLE "budget_version_categories" ADD CONSTRAINT "budget_version_categories_category_owner_kind_fk" FOREIGN KEY ("category_id","owner_id","kind") REFERENCES "public"."categories"("id","owner_id","kind") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "budget_version_thresholds" ADD CONSTRAINT "budget_version_thresholds_version_owner_fk" FOREIGN KEY ("version_id","owner_id") REFERENCES "public"."budget_versions"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_budget_owner_fk" FOREIGN KEY ("budget_id","owner_id") REFERENCES "public"."budgets"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_version_categories_category_idx" ON "budget_version_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "budgets_owner_created_idx" ON "budgets" USING btree ("owner_id","created_at","id");