CREATE TABLE "exchange_rate_history" (
	"rate_type" text NOT NULL,
	"rate_date" date NOT NULL,
	"buy" bigint NOT NULL,
	"sell" bigint NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exchange_rate_history_pkey" PRIMARY KEY("rate_type","rate_date"),
	CONSTRAINT "exchange_rate_history_rate_type_check" CHECK ("exchange_rate_history"."rate_type" in ('oficial', 'blue', 'mep', 'ccl', 'mayorista', 'cripto', 'tarjeta')),
	CONSTRAINT "exchange_rate_history_buy_range_check" CHECK ("exchange_rate_history"."buy" between 1 and 100000000000),
	CONSTRAINT "exchange_rate_history_sell_range_check" CHECK ("exchange_rate_history"."sell" between 1 and 100000000000)
);

--> statement-breakpoint
INSERT INTO "exchange_rate_history" ("rate_type", "rate_date", "buy", "sell", "recorded_at")
SELECT "rate_type", ("fetched_at" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, "buy", "sell", "fetched_at"
FROM "exchange_rates";
