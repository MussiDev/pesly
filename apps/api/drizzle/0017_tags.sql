-- NOTE: the `movements_id_owner_unique` statement below was moved BY HAND before the composite
-- foreign keys of `movement_tags`, because drizzle-kit emits it last and PostgreSQL needs the
-- unique constraint to exist first. The file was generated as 0015_rapid_nocturne and renamed to
-- 0017_tags (07b takes 0015 and 03c takes 0016 on other branches). Regenerating this file loses
-- the reorder: redo it, and run migration.test.ts, which applies this file.
-- Additive: no column or row of `movements` changes.
CREATE TABLE "movement_tags" (
	"movement_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "movement_tags_movement_id_tag_id_pk" PRIMARY KEY("movement_id","tag_id"),
	CONSTRAINT "movement_tags_movement_id_position_unique" UNIQUE("movement_id","position"),
	CONSTRAINT "movement_tags_position_check" CHECK ("movement_tags"."position" between 0 and 9)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "tags_name_length_check" CHECK (char_length("tags"."name") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_id_owner_unique" UNIQUE("id","owner_id");--> statement-breakpoint
ALTER TABLE "movement_tags" ADD CONSTRAINT "movement_tags_movement_owner_fk" FOREIGN KEY ("movement_id","owner_id") REFERENCES "public"."movements"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_tags" ADD CONSTRAINT "movement_tags_tag_owner_fk" FOREIGN KEY ("tag_id","owner_id") REFERENCES "public"."tags"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_tags_tag_idx" ON "movement_tags" USING btree ("tag_id","movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_owner_name_unique" ON "tags" USING btree ("owner_id",lower("name"));--> statement-breakpoint
CREATE INDEX "tags_owner_name_prefix_idx" ON "tags" USING btree ("owner_id",lower("name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "movements_owner_account_date_idx" ON "movements" USING btree ("owner_id","account_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "movements_owner_category_date_idx" ON "movements" USING btree ("owner_id","category_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
