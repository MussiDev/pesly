CREATE TABLE "group_settlement_legs" (
	"settlement_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "group_settlement_legs_pkey" PRIMARY KEY("settlement_id","currency"),
	CONSTRAINT "group_settlement_legs_currency_check" CHECK ("group_settlement_legs"."currency" in ('ARS', 'USD')),
	CONSTRAINT "group_settlement_legs_amount_check" CHECK ("group_settlement_legs"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "group_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"account_id" uuid,
	"account_member_id" uuid,
	"rate" bigint,
	"rate_source" text,
	"rate_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_settlements_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "group_settlements_currency_check" CHECK ("group_settlements"."currency" in ('ARS', 'USD')),
	CONSTRAINT "group_settlements_amount_check" CHECK ("group_settlements"."amount" >= 0),
	CONSTRAINT "group_settlements_distinct_members_check" CHECK ("group_settlements"."from_member_id" <> "group_settlements"."to_member_id"),
	CONSTRAINT "group_settlements_amount_or_rate_check" CHECK ("group_settlements"."amount" > 0 or "group_settlements"."rate_source" is not null),
	CONSTRAINT "group_settlements_rate_positive_check" CHECK ("group_settlements"."rate" is null or "group_settlements"."rate" > 0),
	CONSTRAINT "group_settlements_rate_source_check" CHECK ("group_settlements"."rate_source" is null or "group_settlements"."rate_source" in ('automatic', 'manual')),
	CONSTRAINT "group_settlements_rate_fields_check" CHECK (("group_settlements"."rate" is null) = ("group_settlements"."rate_source" is null)),
	CONSTRAINT "group_settlements_rate_type_check" CHECK ("group_settlements"."rate_type" is null or "group_settlements"."rate_source" = 'automatic'),
	CONSTRAINT "group_settlements_account_member_party_check" CHECK ("group_settlements"."account_member_id" is null or "group_settlements"."account_member_id" in ("group_settlements"."from_member_id", "group_settlements"."to_member_id"))
);
--> statement-breakpoint
ALTER TABLE "group_activity_log" DROP CONSTRAINT "group_activity_log_action_check";--> statement-breakpoint
DROP INDEX "group_members_group_user_unique";--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_settlement_legs" ADD CONSTRAINT "group_settlement_legs_settlement_group_fk" FOREIGN KEY ("settlement_id","group_id") REFERENCES "public"."group_settlements"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_from_group_fk" FOREIGN KEY ("from_member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_to_group_fk" FOREIGN KEY ("to_member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_creator_group_fk" FOREIGN KEY ("created_by_member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_account_member_group_fk" FOREIGN KEY ("account_member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_settlement_legs_group_currency_idx" ON "group_settlement_legs" USING btree ("group_id","currency");--> statement-breakpoint
CREATE INDEX "group_settlements_group_occurred_idx" ON "group_settlements" USING btree ("group_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "group_settlements_account_idx" ON "group_settlements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "group_members_group_active_idx" ON "group_members" USING btree ("group_id") WHERE "group_members"."left_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_user_unique" ON "group_members" USING btree ("group_id","user_id") WHERE "group_members"."user_id" is not null and "group_members"."left_at" is null;--> statement-breakpoint
ALTER TABLE "group_activity_log" ADD CONSTRAINT "group_activity_log_action_check" CHECK ("group_activity_log"."action" in ('expense_created', 'settlement_created'));