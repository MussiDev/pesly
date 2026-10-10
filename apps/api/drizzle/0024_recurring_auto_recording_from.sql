ALTER TABLE "recurring_payments" ADD COLUMN "auto_recording_from" date;--> statement-breakpoint
UPDATE "recurring_payments" AS p SET "auto_recording_from" = (p."created_at" AT TIME ZONE CASE WHEN EXISTS (SELECT 1 FROM "pg_timezone_names" n WHERE n."name" = u."time_zone") THEN u."time_zone" ELSE 'UTC' END)::date FROM "users" AS u WHERE u."id" = p."owner_id";--> statement-breakpoint
ALTER TABLE "recurring_payments" ALTER COLUMN "auto_recording_from" SET DEFAULT current_date;--> statement-breakpoint
ALTER TABLE "recurring_payments" ALTER COLUMN "auto_recording_from" SET NOT NULL;
