import {
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  MOVEMENT_NOTE_MAX_LENGTH,
  MOVEMENT_RATE_SOURCES,
  MOVEMENT_TYPES,
  RATE_MAX_SCALED,
  RATE_TYPES,
} from '@pesly/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { accounts, categories, users } from './foreign-relations';

/**
 * `column in ('a', 'b')` for check constraints. Values are inlined as literals because drizzle-kit
 * cannot bind parameters in DDL; they come from compile-time constants, never from input.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(literals)})`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Inlined in the DDL, so they are literals built from the shared constants, not input. */
const AMOUNT_MAX_LITERAL = sql.raw(MOVEMENT_AMOUNT_MAX_MINOR_UNITS.toString());
const RATE_MAX_LITERAL = sql.raw(RATE_MAX_SCALED.toString());

/**
 * Expenses, income, transfers and exchanges, one row each. The account, destination and category
 * keys are composite so that the database also enforces the owner of the accounts and that the
 * category kind equals the movement type. A transfer or exchange has no category (a null column
 * skips a MATCH SIMPLE key), a destination account and amount, and only an exchange has a rate.
 */
export const movements = pgTable(
  'movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: MOVEMENT_TYPES }).notNull(),
    accountId: uuid('account_id').notNull(),
    /** Null for transfers and exchanges. */
    categoryId: uuid('category_id'),
    /** Positive minor units of the (source) account's currency. */
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    /** The UTC instant; screens show it in the user's time zone. */
    occurredAt: timestamptz('occurred_at').notNull(),
    note: text('note'),
    /**
     * ARS per USD scaled by 10,000, frozen when the movement is recorded; never joined to
     * exchange_rates. Null for transfers; implied by the two amounts for exchanges.
     */
    rate: bigint('rate', { mode: 'bigint' }),
    rateSource: text('rate_source', { enum: MOVEMENT_RATE_SOURCES }),
    rateType: text('rate_type', { enum: RATE_TYPES }),
    /** The receiving account of a transfer or exchange; null for expenses and income. */
    destinationAccountId: uuid('destination_account_id'),
    /** Minor units of the destination account's currency; equals `amount` for a transfer. */
    destinationAmount: bigint('destination_amount', { mode: 'bigint' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'movements_account_owner_fk',
      columns: [table.accountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'movements_category_owner_kind_fk',
      columns: [table.categoryId, table.ownerId, table.type],
      foreignColumns: [categories.id, categories.ownerId, categories.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'movements_destination_owner_fk',
      columns: [table.destinationAccountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    check('movements_type_check', oneOf(table.type, MOVEMENT_TYPES)),
    check('movements_amount_range_check', sql`${table.amount} between 1 and ${AMOUNT_MAX_LITERAL}`),
    check(
      'movements_occurred_at_check',
      sql`${table.occurredAt} >= '1970-01-01T00:00:00Z'::timestamptz`,
    ),
    check(
      'movements_note_length_check',
      sql`char_length(${table.note}) <= ${sql.raw(String(MOVEMENT_NOTE_MAX_LENGTH))}`,
    ),
    check('movements_rate_range_check', sql`${table.rate} between 1 and ${RATE_MAX_LITERAL}`),
    check(
      'movements_destination_amount_range_check',
      sql`${table.destinationAmount} between 1 and ${AMOUNT_MAX_LITERAL}`,
    ),
    check(
      'movements_destination_differs_check',
      sql`${table.destinationAccountId} <> ${table.accountId}`,
    ),
    // The three allowed shapes; the currencies of the two accounts are checked by the use case.
    // A check passes on null, so each column a shape relies on is also guarded with `is not null`.
    check(
      'movements_shape_check',
      sql`(${table.type} in ('expense', 'income') and ${table.categoryId} is not null and ${table.rate} is not null and ${table.rateSource} is not null and ${table.rateSource} in ('automatic', 'manual') and ${table.destinationAccountId} is null and ${table.destinationAmount} is null) or (${table.type} = 'transfer' and ${table.categoryId} is null and ${table.destinationAccountId} is not null and ${table.destinationAmount} is not null and ${table.destinationAmount} = ${table.amount} and ${table.rate} is null and ${table.rateSource} is null and ${table.rateType} is null) or (${table.type} = 'exchange' and ${table.categoryId} is null and ${table.destinationAccountId} is not null and ${table.destinationAmount} is not null and ${table.rate} is not null and ${table.rateSource} is not null and ${table.rateSource} = 'implied' and ${table.rateType} is null)`,
    ),
    check('movements_rate_source_check', oneOf(table.rateSource, MOVEMENT_RATE_SOURCES)),
    // A null rate type passes (a check on null is not violated); the pairing check below ties it to the source.
    check('movements_rate_type_check', oneOf(table.rateType, RATE_TYPES)),
    // An automatic rate names the rate type it was read from; a manual one has none.
    check(
      'movements_rate_source_type_check',
      sql`(${table.rateSource} = 'automatic') = (${table.rateType} is not null)`,
    ),
    // The target of the composite key of movement_tags.
    unique('movements_id_owner_unique').on(table.id, table.ownerId),
    index('movements_owner_date_idx').on(table.ownerId, table.occurredAt.desc(), table.id.desc()),
    index('movements_owner_account_date_idx').on(
      table.ownerId,
      table.accountId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('movements_owner_category_date_idx').on(
      table.ownerId,
      table.categoryId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('movements_account_idx').on(table.accountId),
    index('movements_category_idx').on(table.categoryId),
    index('movements_destination_idx').on(table.destinationAccountId),
  ],
);

/** Fixed-window counters of manual creations per user; at most two rows per user (D8). */
export const movementRateLimits = pgTable(
  'movement_rate_limits',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    windowStart: timestamptz('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.windowStart] }),
    check('movement_rate_limits_count_check', sql`${table.count} >= 0`),
  ],
);

// drizzle.config.ts only globs this file, so the tag relations are re-exported from here.
export { movementTags, tags } from './tags-schema';
