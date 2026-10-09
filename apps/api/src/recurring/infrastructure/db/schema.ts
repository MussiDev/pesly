import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, categories, users } from './foreign-relations';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** 10^15 minor units: the same ceiling as a movement amount. */
const AMOUNT_MAX_LITERAL = sql.raw('1000000000000000');

/**
 * A recurring payment (DISC-001-08a). It is a rule, not a movement: only its confirmed or
 * automatic occurrences become expenses. `schedule_from` is the day the schedule counts from
 * (creation, resume or a schedule edit), so earlier dates are never materialized.
 */
export const recurringPayments = pgTable(
  'recurring_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    accountId: uuid('account_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    /** Always `expense`: the composite key to categories makes the database refuse an income category. */
    categoryKind: text('category_kind').notNull().default('expense'),
    frequency: text('frequency').$type<'weekly' | 'monthly' | 'yearly'>().notNull(),
    /** Monday = 0. Only for weekly payments. */
    weekday: smallint('weekday'),
    dayOfMonth: smallint('day_of_month'),
    month: smallint('month'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    mode: text('mode').$type<'automatic' | 'confirmation'>().notNull(),
    status: text('status').$type<'active' | 'paused'>().notNull().default('active'),
    scheduleFrom: date('schedule_from', { mode: 'string' }).notNull(),
    /**
     * First day whose due dates the scheduler may record without the user (DISC-001-08b). The
     * default is the database session date, only a safety net for raw inserts: the application
     * always sets it in the owner's zone.
     */
    autoRecordingFrom: date('auto_recording_from', { mode: 'string' })
      .notNull()
      .default(sql`current_date`),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('recurring_payments_name_length_check', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'recurring_payments_amount_check',
      sql`${table.amount} between 1 and ${AMOUNT_MAX_LITERAL}`,
    ),
    check(
      'recurring_payments_frequency_check',
      sql`${table.frequency} in ('weekly', 'monthly', 'yearly')`,
    ),
    check('recurring_payments_category_kind_check', sql`${table.categoryKind} = 'expense'`),
    check('recurring_payments_weekday_check', sql`${table.weekday} between 0 and 6`),
    check('recurring_payments_day_of_month_check', sql`${table.dayOfMonth} between 1 and 31`),
    check('recurring_payments_month_check', sql`${table.month} between 1 and 12`),
    check('recurring_payments_mode_check', sql`${table.mode} in ('automatic', 'confirmation')`),
    check('recurring_payments_status_check', sql`${table.status} in ('active', 'paused')`),
    check(
      'recurring_payments_end_after_start_check',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    // The owner is part of both keys, so a payment can only use its own owner's account and
    // (expense) category, and neither can be deleted while a payment uses it.
    foreignKey({
      name: 'recurring_payments_account_owner_fk',
      columns: [table.accountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'recurring_payments_category_owner_fk',
      columns: [table.categoryId, table.ownerId, table.categoryKind],
      foreignColumns: [categories.id, categories.ownerId, categories.kind],
    }).onDelete('restrict'),
    // The target of the occurrences' composite key.
    unique('recurring_payments_id_owner_unique').on(table.id, table.ownerId),
    index('recurring_payments_owner_status_idx').on(table.ownerId, table.status),
  ],
);

/**
 * One due date of a payment. `movement_id` has no foreign key on purpose: deleting a movement must
 * not be blocked by it, and this module does not reference the movements' tables.
 */
export const recurringOccurrences = pgTable(
  'recurring_occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: text('status')
      .$type<'pending' | 'confirmed' | 'skipped'>()
      .notNull()
      .default('pending'),
    confirmedAmount: bigint('confirmed_amount', { mode: 'bigint' }),
    movementId: uuid('movement_id'),
    resolvedAt: timestamptz('resolved_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'recurring_occurrences_status_check',
      sql`${table.status} in ('pending', 'confirmed', 'skipped')`,
    ),
    check(
      'recurring_occurrences_confirmed_amount_check',
      sql`${table.confirmedAmount} is null or ${table.confirmedAmount} between 1 and ${AMOUNT_MAX_LITERAL}`,
    ),
    foreignKey({
      name: 'recurring_occurrences_payment_owner_fk',
      columns: [table.paymentId, table.ownerId],
      foreignColumns: [recurringPayments.id, recurringPayments.ownerId],
    }).onDelete('cascade'),
    unique('recurring_occurrences_payment_due_unique').on(table.paymentId, table.dueDate),
    index('recurring_occurrences_owner_status_due_idx').on(
      table.ownerId,
      table.status,
      table.dueDate,
    ),
  ],
);
