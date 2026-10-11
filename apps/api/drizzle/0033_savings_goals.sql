CREATE TABLE "goal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_entries_kind_check" CHECK ("goal_entries"."kind" in ('contribution', 'withdrawal')),
	CONSTRAINT "goal_entries_amount_check" CHECK ("goal_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"target_date" date,
	"linked_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "goals_name_length_check" CHECK (char_length("goals"."name") between 1 and 80),
	CONSTRAINT "goals_target_amount_check" CHECK ("goals"."target_amount" > 0),
	CONSTRAINT "goals_currency_check" CHECK ("goals"."currency" in ('ARS', 'USD'))
);
--> statement-breakpoint
ALTER TABLE "goal_entries" ADD CONSTRAINT "goal_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_entries" ADD CONSTRAINT "goal_entries_goal_owner_fk" FOREIGN KEY ("goal_id","owner_id") REFERENCES "public"."goals"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_owner_fk" FOREIGN KEY ("linked_account_id","owner_id") REFERENCES "public"."accounts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_entries_goal_created_idx" ON "goal_entries" USING btree ("goal_id","created_at","id");--> statement-breakpoint
CREATE INDEX "goal_entries_owner_idx" ON "goal_entries" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "goals_owner_created_idx" ON "goals" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "goals_linked_account_idx" ON "goals" USING btree ("linked_account_id") WHERE "goals"."linked_account_id" is not null;