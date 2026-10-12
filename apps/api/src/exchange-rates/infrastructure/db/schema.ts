import { RATE_MAX_SCALED, RATE_TYPES } from '@pesly/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { RateProviderFailureCode } from '../../domain/errors';

/**
 * `column in ('a', 'b')` for check constraints. Values are inlined as literals because drizzle-kit
 * cannot bind parameters in DDL; they come from compile-time constants, never from input.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(literals)})`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Typed against the domain union so a new failure code cannot be forgotten here.
const REFRESH_FAILURE_CODES = [
  'provider_unreachable',
  'provider_timeout',
  'provider_bad_status',
  'provider_invalid_payload',
] as const satisfies readonly RateProviderFailureCode[];

/** Inlined in the DDL, so it is a literal built from the shared constant, not input. */
const RATE_MAX_LITERAL = sql.raw(RATE_MAX_SCALED.toString());

/** One row per rate type, replaced in place by each refresh. Rates are ARS per USD scaled by 10,000. */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    rateType: text('rate_type', { enum: RATE_TYPES }).primaryKey(),
    buy: bigint('buy', { mode: 'bigint' }).notNull(),
    sell: bigint('sell', { mode: 'bigint' }).notNull(),
    providerUpdatedAt: timestamptz('provider_updated_at').notNull(),
    fetchedAt: timestamptz('fetched_at').notNull(),
  },
  (table) => [
    check('exchange_rates_rate_type_check', oneOf(table.rateType, RATE_TYPES)),
    check('exchange_rates_buy_range_check', sql`${table.buy} between 1 and ${RATE_MAX_LITERAL}`),
    check('exchange_rates_sell_range_check', sql`${table.sell} between 1 and ${RATE_MAX_LITERAL}`),
  ],
);

/**
 * One row per rate type and Argentina calendar day, the last values of the day winning. Feeds the
 * month-end conversion of the net worth report. No foreign key: it outlives any one stored rate.
 */
export const exchangeRateHistory = pgTable(
  'exchange_rate_history',
  {
    rateType: text('rate_type', { enum: RATE_TYPES }).notNull(),
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    buy: bigint('buy', { mode: 'bigint' }).notNull(),
    sell: bigint('sell', { mode: 'bigint' }).notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'exchange_rate_history_pkey', columns: [table.rateType, table.rateDate] }),
    check('exchange_rate_history_rate_type_check', oneOf(table.rateType, RATE_TYPES)),
    check(
      'exchange_rate_history_buy_range_check',
      sql`${table.buy} between 1 and ${RATE_MAX_LITERAL}`,
    ),
    check(
      'exchange_rate_history_sell_range_check',
      sql`${table.sell} between 1 and ${RATE_MAX_LITERAL}`,
    ),
  ],
);

/** The single schedule row (id = 1), created by the first claim; `next_attempt_at` doubles as the lease. */
export const exchangeRateSync = pgTable(
  'exchange_rate_sync',
  {
    id: smallint('id').primaryKey(),
    nextAttemptAt: timestamptz('next_attempt_at').notNull(),
    lastSuccessAt: timestamptz('last_success_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  },
  (table) => [
    check('exchange_rate_sync_single_row_check', sql`${table.id} = 1`),
    check('exchange_rate_sync_failures_check', sql`${table.consecutiveFailures} >= 0`),
  ],
);

/** Operational log of failed refreshes; never holds provider text, only a code and a short detail. */
export const exchangeRateRefreshFailures = pgTable(
  'exchange_rate_refresh_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    failedAt: timestamptz('failed_at').notNull(),
    code: text('code', { enum: REFRESH_FAILURE_CODES }).notNull(),
    statusCode: smallint('status_code'),
    detail: text('detail'),
  },
  (table) => [
    check('exchange_rate_refresh_failures_code_check', oneOf(table.code, REFRESH_FAILURE_CODES)),
    check(
      'exchange_rate_refresh_failures_status_code_check',
      sql`${table.statusCode} between 100 and 599`,
    ),
    check(
      'exchange_rate_refresh_failures_detail_length_check',
      sql`char_length(${table.detail}) <= 200`,
    ),
    index('exchange_rate_refresh_failures_failed_at_idx').on(table.failedAt),
  ],
);
