CREATE TABLE "group_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "group_activity_log_action_check" CHECK ("group_activity_log"."action" in ('expense_created'))
);
--> statement-breakpoint
CREATE TABLE "group_default_split_shares" (
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"basis_points" integer NOT NULL,
	CONSTRAINT "group_default_split_shares_pkey" PRIMARY KEY("group_id","member_id"),
	CONSTRAINT "group_default_split_shares_basis_points_check" CHECK ("group_default_split_shares"."basis_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "group_expense_shares" (
	"expense_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"basis_points" integer,
	CONSTRAINT "group_expense_shares_pkey" PRIMARY KEY("expense_id","member_id"),
	CONSTRAINT "group_expense_shares_amount_check" CHECK ("group_expense_shares"."amount" >= 0),
	CONSTRAINT "group_expense_shares_basis_points_check" CHECK ("group_expense_shares"."basis_points" is null or "group_expense_shares"."basis_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "group_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"payer_member_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"split_mode" text NOT NULL,
	"payer_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_expenses_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "group_expenses_amount_check" CHECK ("group_expenses"."amount" > 0),
	CONSTRAINT "group_expenses_currency_check" CHECK ("group_expenses"."currency" in ('ARS', 'USD')),
	CONSTRAINT "group_expenses_description_length_check" CHECK (char_length("group_expenses"."description") between 1 and 200),
	CONSTRAINT "group_expenses_split_mode_check" CHECK ("group_expenses"."split_mode" in ('equal', 'percentage', 'exact'))
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "default_split_mode" text DEFAULT 'equal' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_member_group_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_default_split_shares" ADD CONSTRAINT "group_default_split_shares_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_default_split_shares" ADD CONSTRAINT "group_default_split_shares_member_group_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_shares" ADD CONSTRAINT "group_expense_shares_expense_group_fk" FOREIGN KEY ("expense_id","group_id") REFERENCES "public"."group_expenses"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_shares" ADD CONSTRAINT "group_expense_shares_member_group_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_category_id_group_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."group_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_payer_movement_id_movements_id_fk" FOREIGN KEY ("payer_movement_id") REFERENCES "public"."movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_payer_group_fk" FOREIGN KEY ("payer_member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_creator_group_fk" FOREIGN KEY ("created_by_member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_activity_log_group_created_idx" ON "group_activity_log" USING btree ("group_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "group_expense_shares_member_idx" ON "group_expense_shares" USING btree ("member_id","expense_id");--> statement-breakpoint
CREATE INDEX "group_expenses_group_occurred_idx" ON "group_expenses" USING btree ("group_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "group_expenses_payer_idx" ON "group_expenses" USING btree ("payer_member_id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_default_split_mode_check" CHECK ("groups"."default_split_mode" in ('equal', 'percentage'));