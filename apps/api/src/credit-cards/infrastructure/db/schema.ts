import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, categories, users } from './foreign-relations';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const creditCards = pgTable(
  'credit_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    closingDay: smallint('closing_day').notNull(),
    dueDay: smallint('due_day').notNull(),
    arsAccountId: uuid('ars_account_id').notNull(),
    usdAccountId: uuid('usd_account_id').notNull(),
    /** Optional automatic debit account per currency (DISC-001-10e). */
    debitArsAccountId: uuid('debit_ars_account_id'),
    debitUsdAccountId: uuid('debit_usd_account_id'),
    /** The owner's local date at link time: a debit is never due for an earlier statement. */
    debitArsLinkedOn: date('debit_ars_linked_on', { mode: 'string' }),
    debitUsdLinkedOn: date('debit_usd_linked_on', { mode: 'string' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Mirrors the request validation as defence in depth (user decision D3).
    check('credit_cards_name_length_check', sql`char_length(${table.name}) between 1 and 46`),
    check('credit_cards_closing_day_check', sql`${table.closingDay} between 1 and 31`),
    check('credit_cards_due_day_check', sql`${table.dueDay} between 1 and 31`),
    check(
      'credit_cards_distinct_accounts_check',
      sql`${table.arsAccountId} <> ${table.usdAccountId}`,
    ),
    // The owner is part of both keys, so a card can only link accounts of its own owner, and a
    // linked account cannot be deleted while the card exists.
    foreignKey({
      name: 'credit_cards_ars_account_owner_fk',
      columns: [table.arsAccountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'credit_cards_usd_account_owner_fk',
      columns: [table.usdAccountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'credit_cards_debit_ars_account_owner_fk',
      columns: [table.debitArsAccountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'credit_cards_debit_usd_account_owner_fk',
      columns: [table.debitUsdAccountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    check(
      'credit_cards_debit_ars_linked_check',
      sql`(${table.debitArsAccountId} is null) = (${table.debitArsLinkedOn} is null)`,
    ),
    check(
      'credit_cards_debit_usd_linked_check',
      sql`(${table.debitUsdAccountId} is null) = (${table.debitUsdLinkedOn} is null)`,
    ),
    check(
      'credit_cards_debit_ars_not_card_account_check',
      sql`${table.debitArsAccountId} is null or (${table.debitArsAccountId} <> ${table.arsAccountId} and ${table.debitArsAccountId} <> ${table.usdAccountId})`,
    ),
    check(
      'credit_cards_debit_usd_not_card_account_check',
      sql`${table.debitUsdAccountId} is null or (${table.debitUsdAccountId} <> ${table.arsAccountId} and ${table.debitUsdAccountId} <> ${table.usdAccountId})`,
    ),
    // Serves the automatic debit job's keyset page over cards that have a debit account.
    index('credit_cards_automatic_debit_idx')
      .on(table.id)
      .where(sql`${table.debitArsAccountId} is not null or ${table.debitUsdAccountId} is not null`),
    unique('credit_cards_ars_account_unique').on(table.arsAccountId),
    unique('credit_cards_usd_account_unique').on(table.usdAccountId),
    // The target of the statements' composite key.
    unique('credit_cards_id_owner_unique').on(table.id, table.ownerId),
    index('credit_cards_owner_created_idx').on(table.ownerId, table.createdAt, table.id),
  ],
);

export const creditCardStatements = pgTable(
  'credit_card_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    /** The cycle's month, `YYYY-MM`. */
    period: text('period').notNull(),
    closingDate: date('closing_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'credit_card_statements_period_check',
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      'credit_card_statements_due_after_closing_check',
      sql`${table.dueDate} > ${table.closingDate}`,
    ),
    foreignKey({
      name: 'credit_card_statements_card_owner_fk',
      columns: [table.cardId, table.ownerId],
      foreignColumns: [creditCards.id, creditCards.ownerId],
    }).onDelete('cascade'),
    unique('credit_card_statements_card_period_unique').on(table.cardId, table.period),
    index('credit_card_statements_owner_idx').on(table.ownerId),
    index('credit_card_statements_card_closing_idx').on(table.cardId, table.closingDate),
  ],
);

/** 10^15 minor units: the same ceiling as a movement amount. */
const AMOUNT_MAX_LITERAL = sql.raw('1000000000000000');

/**
 * An installment purchase on a card (DISC-001-10c). It is not a movement: only its installments
 * count as spending. `category_kind` is always `expense`, so the composite key to categories makes
 * the database refuse an income category.
 */
export const installmentPurchases = pgTable(
  'installment_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    categoryKind: text('category_kind').notNull().default('expense'),
    totalAmount: bigint('total_amount', { mode: 'bigint' }).notNull(),
    /** The purchase currency; its installments inherit it. */
    currency: text('currency').$type<'ARS' | 'USD'>().notNull().default('ARS'),
    installmentCount: smallint('installment_count').notNull(),
    /** The calendar day of the purchase in the user's time zone. */
    purchasedOn: date('purchased_on', { mode: 'string' }).notNull(),
    note: text('note'),
    /** Set when a deletion kept installments of closed statements (spec D5). */
    cancelledAt: timestamptz('cancelled_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'installment_purchases_total_range_check',
      sql`${table.totalAmount} between 1 and ${AMOUNT_MAX_LITERAL}`,
    ),
    check('installment_purchases_currency_check', sql`${table.currency} in ('ARS', 'USD')`),
    check('installment_purchases_count_check', sql`${table.installmentCount} between 2 and 60`),
    check(
      'installment_purchases_total_covers_count_check',
      sql`${table.totalAmount} >= ${table.installmentCount}`,
    ),
    check('installment_purchases_category_kind_check', sql`${table.categoryKind} = 'expense'`),
    check(
      'installment_purchases_note_length_check',
      sql`${table.note} is null or char_length(${table.note}) <= 500`,
    ),
    foreignKey({
      name: 'installment_purchases_card_owner_fk',
      columns: [table.cardId, table.ownerId],
      foreignColumns: [creditCards.id, creditCards.ownerId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'installment_purchases_category_owner_kind_fk',
      columns: [table.categoryId, table.ownerId, table.categoryKind],
      foreignColumns: [categories.id, categories.ownerId, categories.kind],
    }).onDelete('restrict'),
    // The target of the installments' composite key.
    unique('installment_purchases_id_owner_unique').on(table.id, table.ownerId),
    index('installment_purchases_owner_card_idx').on(table.ownerId, table.cardId, table.createdAt),
    index('installment_purchases_category_idx').on(table.categoryId),
  ],
);

/** One installment, assigned to the statement of `period` (spec D1). */
export const installments = pgTable(
  'installments',
  {
    purchaseId: uuid('purchase_id').notNull(),
    /** The purchase's owner, so every query on installments is scoped like the rest (AGENTS.md). */
    ownerId: uuid('owner_id').notNull(),
    number: smallint('number').notNull(),
    period: text('period').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'installments_pk', columns: [table.purchaseId, table.number] }),
    foreignKey({
      name: 'installments_purchase_owner_fk',
      columns: [table.purchaseId, table.ownerId],
      foreignColumns: [installmentPurchases.id, installmentPurchases.ownerId],
    }).onDelete('cascade'),
    index('installments_owner_idx').on(table.ownerId),
    check('installments_number_check', sql`${table.number} between 1 and 60`),
    check('installments_period_check', sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'installments_amount_range_check',
      sql`${table.amount} between 1 and ${AMOUNT_MAX_LITERAL}`,
    ),
  ],
);

/**
 * One line of an imported card statement, recorded by its fingerprint so importing the same file
 * again creates nothing twice. Only the hash is kept: no description, amount or voucher.
 */
export const cardStatementImportLines = pgTable(
  'card_statement_import_lines',
  {
    ownerId: uuid('owner_id').notNull(),
    cardId: uuid('card_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'card_statement_import_lines_pk',
      columns: [table.ownerId, table.cardId, table.fingerprint],
    }),
    check(
      'card_statement_import_lines_fingerprint_check',
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
      name: 'card_statement_import_lines_card_owner_fk',
      columns: [table.cardId, table.ownerId],
      foreignColumns: [creditCards.id, creditCards.ownerId],
    }).onDelete('cascade'),
  ],
);

/**
 * The claim of one automatic debit per statement and currency (DISC-001-10e). It stores no amount
 * and has no key to movements on purpose: the user may delete or edit the transfer, and the claim
 * must outlive it so the debit is never re-created.
 */
export const cardAutomaticDebits = pgTable(
  'card_automatic_debits',
  {
    cardId: uuid('card_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    /** The statement's month, `YYYY-MM`. */
    period: text('period').notNull(),
    currency: text('currency').$type<'ARS' | 'USD'>().notNull(),
    status: text('status').$type<'pending' | 'recorded' | 'skipped'>().notNull(),
    reason: text('reason').$type<'covered' | 'account_unavailable' | 'refused'>(),
    movementId: uuid('movement_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'card_automatic_debits_pk',
      columns: [table.cardId, table.period, table.currency],
    }),
    check(
      'card_automatic_debits_period_check',
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check('card_automatic_debits_currency_check', sql`${table.currency} in ('ARS', 'USD')`),
    check(
      'card_automatic_debits_status_check',
      sql`${table.status} in ('pending', 'recorded', 'skipped')`,
    ),
    check(
      'card_automatic_debits_reason_check',
      sql`${table.reason} is null or ${table.reason} in ('covered', 'account_unavailable', 'refused')`,
    ),
    check(
      'card_automatic_debits_state_check',
      sql`(${table.status} = 'recorded' and ${table.movementId} is not null and ${table.reason} is null) or (${table.status} = 'skipped' and ${table.movementId} is null and ${table.reason} is not null) or (${table.status} = 'pending' and ${table.movementId} is null and ${table.reason} is null)`,
    ),
    foreignKey({
      name: 'card_automatic_debits_card_owner_fk',
      columns: [table.cardId, table.ownerId],
      foreignColumns: [creditCards.id, creditCards.ownerId],
    }).onDelete('cascade'),
    index('card_automatic_debits_owner_idx').on(table.ownerId),
  ],
);
