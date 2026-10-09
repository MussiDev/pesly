CREATE TABLE "card_statement_import_lines" (
	"owner_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_statement_import_lines_pk" PRIMARY KEY("owner_id","card_id","fingerprint"),
	CONSTRAINT "card_statement_import_lines_fingerprint_check" CHECK ("card_statement_import_lines"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "card_statement_import_lines" ADD CONSTRAINT "card_statement_import_lines_card_owner_fk" FOREIGN KEY ("card_id","owner_id") REFERENCES "public"."credit_cards"("id","owner_id") ON DELETE cascade ON UPDATE no action;