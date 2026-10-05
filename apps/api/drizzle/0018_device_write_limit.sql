-- NOTE: the statements below were reordered BY HAND: drizzle-kit emitted the primary key swap
-- before ADD COLUMN, and the new key needs the `bucket` column to exist first. Regenerating this
-- file loses the reorder: redo it, and run migration.test.ts, which applies this file.
-- Additive for data: a column with a default ('manual'), so every counter that exists keeps its
-- count and is read as a manual one. The primary key of a table that holds about one row per user
-- gains the bucket; the table is rewritten in milliseconds.
ALTER TABLE "movement_rate_limits" ADD COLUMN "bucket" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "movement_rate_limits" DROP CONSTRAINT "movement_rate_limits_owner_id_window_start_pk";--> statement-breakpoint
ALTER TABLE "movement_rate_limits" ADD CONSTRAINT "movement_rate_limits_owner_id_bucket_window_start_pk" PRIMARY KEY("owner_id","bucket","window_start");--> statement-breakpoint
ALTER TABLE "movement_rate_limits" ADD CONSTRAINT "movement_rate_limits_bucket_check" CHECK ("movement_rate_limits"."bucket" in ('manual', 'device'));
