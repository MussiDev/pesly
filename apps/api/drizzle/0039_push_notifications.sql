CREATE TABLE "push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_notice_subscription_unique" UNIQUE("notice_id","subscription_id"),
	CONSTRAINT "push_deliveries_status_check" CHECK ("push_deliveries"."status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "push_deliveries_attempts_check" CHECK ("push_deliveries"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_length_check" CHECK (char_length("push_subscriptions"."endpoint") between 1 and 2048),
	CONSTRAINT "push_subscriptions_p256dh_length_check" CHECK (char_length("push_subscriptions"."p256dh") = 87),
	CONSTRAINT "push_subscriptions_auth_length_check" CHECK (char_length("push_subscriptions"."auth") = 22)
);
--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "push_handled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_deliveries_due_idx" ON "push_deliveries" USING btree ("next_attempt_at") WHERE "push_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "push_deliveries_subscription_idx" ON "push_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "push_deliveries_done_idx" ON "push_deliveries" USING btree ("updated_at") WHERE "push_deliveries"."status" <> 'pending';--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_updated_idx" ON "push_subscriptions" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- Notices that exist before the deploy are never pushed (PRD Out of Scope); the index comes after.
UPDATE "notices" SET "push_handled_at" = now();--> statement-breakpoint
CREATE INDEX "notices_push_unhandled_idx" ON "notices" USING btree ("created_at") WHERE "notices"."push_handled_at" is null;