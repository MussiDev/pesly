import {
  INSTRUMENT_NAME_MAX_LENGTH,
  INSTRUMENT_TYPES,
  PORTFOLIO_NAME_MAX_LENGTH,
  PRICE_SOURCES,
  QUANTITY_MAX,
  TICKER_MAX_LENGTH,
  TOTAL_COST_MAX,
  UNIT_PRICE_MAX,
  VALUATION_CURRENCIES,
} from '@pesly/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgDatabase,
} from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
// Deliberate read-only import across modules: `users` is only the target of a foreign key.
import { users } from '../../../identity/infrastructure/db/schema';
import { PRICE_FAILURE_CODES } from '../../domain/price-failure';

/** The database or an open transaction: repositories accept either so use cases can compose them. */
export type InvestmentsDb = PgDatabase<NodePgQueryResultHKT>;

/**
 * `column in ('a', 'b')` for check constraints. Values are inlined as literals because drizzle-kit
 * cannot bind parameters in DDL; they come from compile-time constants, never from input.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(literals)})`;
}

/** `column > 0 and column <= max`; the bound is a compile-time bigint constant, inlined for DDL. */
function between1And(column: AnyPgColumn, max: bigint): SQL {
  return sql`${column} > 0 and ${column} <= ${sql.raw(max.toString())}`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const HOLDINGS_PORTFOLIO_TICKER_KEY = 'holdings_portfolio_ticker_key';

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'portfolios_name_length_check',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(PORTFOLIO_NAME_MAX_LENGTH))}`,
    ),
    // The target of the composite foreign key of `holdings`.
    unique('portfolios_id_owner_id_key').on(table.id, table.ownerId),
    index('portfolios_owner_id_idx').on(table.ownerId),
  ],
);

export const holdings = pgTable(
  'holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    ticker: text('ticker').notNull(),
    instrumentName: text('instrument_name').notNull(),
    instrumentType: text('instrument_type', { enum: INSTRUMENT_TYPES }).notNull(),
    /** Scaled by 10^8; `bigint` mode, because a JavaScript number loses precision above 2^53. */
    quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
    valuationCurrency: text('valuation_currency', { enum: VALUATION_CURRENCIES }).notNull(),
    /** Minor units of the valuation currency. */
    totalCost: bigint('total_cost', { mode: 'bigint' }),
    /** Minor units; the three price columns are all null or all set. */
    unitPrice: bigint('unit_price', { mode: 'bigint' }),
    priceSource: text('price_source', { enum: PRICE_SOURCES }),
    pricedAt: timestamptz('priced_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // A holding can never carry another owner than its portfolio.
    foreignKey({
      name: 'holdings_portfolio_owner_fk',
      columns: [table.portfolioId, table.ownerId],
      foreignColumns: [portfolios.id, portfolios.ownerId],
    }).onDelete('cascade'),
    check(
      'holdings_ticker_length_check',
      sql`char_length(${table.ticker}) between 1 and ${sql.raw(String(TICKER_MAX_LENGTH))}`,
    ),
    check(
      'holdings_instrument_name_length_check',
      sql`char_length(${table.instrumentName}) between 1 and ${sql.raw(String(INSTRUMENT_NAME_MAX_LENGTH))}`,
    ),
    check('holdings_instrument_type_check', oneOf(table.instrumentType, INSTRUMENT_TYPES)),
    check(
      'holdings_valuation_currency_check',
      oneOf(table.valuationCurrency, VALUATION_CURRENCIES),
    ),
    check('holdings_quantity_check', between1And(table.quantity, QUANTITY_MAX)),
    check(
      'holdings_total_cost_check',
      sql`${table.totalCost} is null or (${between1And(table.totalCost, TOTAL_COST_MAX)})`,
    ),
    check(
      'holdings_unit_price_check',
      sql`${table.unitPrice} is null or (${between1And(table.unitPrice, UNIT_PRICE_MAX)})`,
    ),
    check(
      'holdings_price_source_check',
      sql`${table.priceSource} is null or (${oneOf(table.priceSource, PRICE_SOURCES)})`,
    ),
    check(
      'holdings_price_all_or_none_check',
      sql`(${table.unitPrice} is null and ${table.priceSource} is null and ${table.pricedAt} is null) or (${table.unitPrice} is not null and ${table.priceSource} is not null and ${table.pricedAt} is not null)`,
    ),
    check(
      'holdings_crypto_usd_check',
      sql`${table.instrumentType} <> 'crypto' or ${table.valuationCurrency} = 'USD'`,
    ),
    uniqueIndex(HOLDINGS_PORTFOLIO_TICKER_KEY).on(table.portfolioId, sql`lower(${table.ticker})`),
    index('holdings_owner_id_idx').on(table.ownerId),
    // Serves the hourly price update and the symbol read without scanning every holding.
    index('holdings_crypto_ticker_idx')
      .on(sql`lower(${table.ticker})`)
      .where(sql`${table.instrumentType} = 'crypto'`),
  ],
);

/** The single schedule row (id = 1), created by the first claim; `next_attempt_at` doubles as the lease. */
export const cryptoPriceSync = pgTable(
  'crypto_price_sync',
  {
    id: smallint('id').primaryKey(),
    nextAttemptAt: timestamptz('next_attempt_at').notNull(),
    lastSuccessAt: timestamptz('last_success_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  },
  (table) => [
    check('crypto_price_sync_single_row_check', sql`${table.id} = 1`),
    check('crypto_price_sync_failures_check', sql`${table.consecutiveFailures} >= 0`),
  ],
);

/** Provider calls reserved per UTC month (`YYYY-MM`); the limit lives in the reservation statement. */
export const cryptoPriceUsage = pgTable(
  'crypto_price_usage',
  {
    month: text('month').primaryKey(),
    calls: integer('calls').notNull().default(0),
  },
  (table) => [
    check('crypto_price_usage_month_check', sql`${table.month} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('crypto_price_usage_calls_check', sql`${table.calls} between 0 and 1000`),
  ],
);

/** Operational log of failed refreshes; never holds provider text, only a code and a short detail. */
export const cryptoPriceRefreshFailures = pgTable(
  'crypto_price_refresh_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    failedAt: timestamptz('failed_at').notNull(),
    code: text('code', { enum: PRICE_FAILURE_CODES }).notNull(),
    statusCode: smallint('status_code'),
    detail: text('detail'),
  },
  (table) => [
    check('crypto_price_refresh_failures_code_check', oneOf(table.code, PRICE_FAILURE_CODES)),
    check(
      'crypto_price_refresh_failures_status_code_check',
      sql`${table.statusCode} between 100 and 599`,
    ),
    check(
      'crypto_price_refresh_failures_detail_length_check',
      sql`char_length(${table.detail}) <= 200`,
    ),
    index('crypto_price_refresh_failures_failed_at_idx').on(table.failedAt),
  ],
);

/** Public market data, one row per CoinGecko symbol: no owner and no foreign key, not user data. */
export const cryptoMarketPrices = pgTable(
  'crypto_market_prices',
  {
    symbol: text('symbol').primaryKey(),
    /** US cents; the same range as the holdings price check, so the copy onto a holding never fails. */
    unitPrice: bigint('unit_price', { mode: 'bigint' }).notNull(),
    pricedAt: timestamptz('priced_at').notNull(),
  },
  (table) => [
    check('crypto_market_prices_symbol_check', sql`${table.symbol} ~ '^[a-z0-9._-]{1,20}$'`),
    check(
      'crypto_market_prices_unit_price_check',
      sql`${table.unitPrice} between 1 and ${sql.raw(UNIT_PRICE_MAX.toString())}`,
    ),
  ],
);

/** The total value of a portfolio per currency at the end of an owner local day. */
export const portfolioValueSnapshots = pgTable(
  'portfolio_value_snapshots',
  {
    portfolioId: uuid('portfolio_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    /** The owner local date, `YYYY-MM-DD`. */
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    currency: text('currency', { enum: VALUATION_CURRENCIES }).notNull(),
    /** Minor units of the currency. */
    totalValue: bigint('total_value', { mode: 'bigint' }).notNull(),
    takenAt: timestamptz('taken_at').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'portfolio_value_snapshots_pkey',
      columns: [table.portfolioId, table.snapshotDate, table.currency],
    }),
    // A snapshot can never carry another owner than its portfolio.
    foreignKey({
      name: 'portfolio_value_snapshots_portfolio_owner_fk',
      columns: [table.portfolioId, table.ownerId],
      foreignColumns: [portfolios.id, portfolios.ownerId],
    }).onDelete('cascade'),
    check('portfolio_value_snapshots_currency_check', oneOf(table.currency, VALUATION_CURRENCIES)),
    check('portfolio_value_snapshots_total_value_check', sql`${table.totalValue} >= 0`),
    index('portfolio_value_snapshots_owner_date_idx').on(table.ownerId, table.snapshotDate),
  ],
);
