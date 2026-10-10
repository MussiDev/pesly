CREATE TABLE "group_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"default_key" text,
	"name" text,
	"icon" text NOT NULL,
	"color" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_categories_default_key_length_check" CHECK ("group_categories"."default_key" is null or char_length("group_categories"."default_key") between 1 and 60),
	CONSTRAINT "group_categories_name_length_check" CHECK ("group_categories"."name" is null or char_length("group_categories"."name") between 1 and 50),
	CONSTRAINT "group_categories_key_or_name_check" CHECK ("group_categories"."default_key" is not null or "group_categories"."name" is not null),
	CONSTRAINT "group_categories_icon_length_check" CHECK (char_length("group_categories"."icon") between 1 and 40),
	CONSTRAINT "group_categories_color_length_check" CHECK (char_length("group_categories"."color") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "group_claim_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_claim_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "group_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "group_invitations_created_by_member_unique" UNIQUE("created_by_member_id")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "group_members_display_name_length_check" CHECK ("group_members"."display_name" is null or char_length("group_members"."display_name") between 1 and 50),
	CONSTRAINT "group_members_role_check" CHECK ("group_members"."role" in ('admin', 'member')),
	CONSTRAINT "group_members_user_or_name_check" CHECK ("group_members"."user_id" is not null or "group_members"."display_name" is not null),
	CONSTRAINT "group_members_not_both_check" CHECK ("group_members"."user_id" is null or "group_members"."display_name" is null),
	CONSTRAINT "group_members_admin_registered_check" CHECK ("group_members"."role" = 'member' or "group_members"."user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_rate_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_length_check" CHECK (char_length("groups"."name") between 1 and 50),
	CONSTRAINT "groups_default_rate_type_check" CHECK ("groups"."default_rate_type" in ('oficial', 'blue', 'mep', 'ccl', 'mayorista', 'cripto', 'tarjeta'))
);
--> statement-breakpoint
ALTER TABLE "group_categories" ADD CONSTRAINT "group_categories_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_claim_links" ADD CONSTRAINT "group_claim_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_claim_links" ADD CONSTRAINT "group_claim_links_member_group_fk" FOREIGN KEY ("member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_creator_group_fk" FOREIGN KEY ("created_by_member_id","group_id") REFERENCES "public"."group_members"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_categories_group_default_key_unique" ON "group_categories" USING btree ("group_id","default_key") WHERE "group_categories"."default_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "group_categories_group_name_unique" ON "group_categories" USING btree ("group_id",lower("name")) WHERE "group_categories"."name" is not null;--> statement-breakpoint
CREATE INDEX "group_categories_group_created_idx" ON "group_categories" USING btree ("group_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_claim_links_member_unused_unique" ON "group_claim_links" USING btree ("member_id") WHERE "group_claim_links"."used_at" is null;--> statement-breakpoint
CREATE INDEX "group_invitations_group_idx" ON "group_invitations" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_user_unique" ON "group_members" USING btree ("group_id","user_id") WHERE "group_members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_members_group_joined_idx" ON "group_members" USING btree ("group_id","joined_at","id");