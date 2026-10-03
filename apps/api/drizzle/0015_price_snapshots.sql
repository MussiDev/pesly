CREATE TABLE "crypto_market_prices" (
	"symbol" text PRIMARY KEY NOT NULL,
	"unit_price" bigint NOT NULL,
	"priced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "crypto_market_prices_symbol_check" CHECK ("crypto_market_prices"."symbol" ~ '^[a-z0-9._-]{1,20}$'),
	CONSTRAINT "crypto_market_prices_unit_price_check" CHECK ("crypto_market_prices"."unit_price" between 1 and 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "crypto_price_refresh_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	"code" text NOT NULL,
	"status_code" smallint,
	"detail" text,
	CONSTRAINT "crypto_price_refresh_failures_code_check" CHECK ("crypto_price_refresh_failures"."code" in ('provider_unreachable', 'provider_timeout', 'provider_bad_status', 'provider_rate_limited', 'provider_invalid_payload')),
	CONSTRAINT "crypto_price_refresh_failures_status_code_check" CHECK ("crypto_price_refresh_failures"."status_code" between 100 and 599),
	CONSTRAINT "crypto_price_refresh_failures_detail_length_check" CHECK (char_length("crypto_price_refresh_failures"."detail") <= 200)
);
--> statement-breakpoint
CREATE TABLE "crypto_price_sync" (
	"id" smallint PRIMARY KEY NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "crypto_price_sync_single_row_check" CHECK ("crypto_price_sync"."id" = 1),
	CONSTRAINT "crypto_price_sync_failures_check" CHECK ("crypto_price_sync"."consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crypto_price_usage" (
	"month" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "crypto_price_usage_month_check" CHECK ("crypto_price_usage"."month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "crypto_price_usage_calls_check" CHECK ("crypto_price_usage"."calls" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "portfolio_value_snapshots" (
	"portfolio_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"currency" text NOT NULL,
	"total_value" bigint NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portfolio_value_snapshots_pkey" PRIMARY KEY("portfolio_id","snapshot_date","currency"),
	CONSTRAINT "portfolio_value_snapshots_currency_check" CHECK ("portfolio_value_snapshots"."currency" in ('ARS', 'USD')),
	CONSTRAINT "portfolio_value_snapshots_total_value_check" CHECK ("portfolio_value_snapshots"."total_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "portfolio_value_snapshots" ADD CONSTRAINT "portfolio_value_snapshots_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","owner_id") REFERENCES "public"."portfolios"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crypto_price_refresh_failures_failed_at_idx" ON "crypto_price_refresh_failures" USING btree ("failed_at");--> statement-breakpoint
CREATE INDEX "portfolio_value_snapshots_owner_date_idx" ON "portfolio_value_snapshots" USING btree ("owner_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "holdings_crypto_ticker_idx" ON "holdings" USING btree (lower("ticker")) WHERE "holdings"."instrument_type" = 'crypto';