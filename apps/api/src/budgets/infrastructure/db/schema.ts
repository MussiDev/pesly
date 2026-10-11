import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { categories, users } from './foreign-relations';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** The immutable identity of a budget; its values live in `budget_versions` (DISC-001-06b D2). */
export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    currency: text('currency').$type<'ARS' | 'USD'>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Target of the composite keys of the children, so a child cannot point at another owner's budget.
    unique('budgets_id_owner_unique').on(table.id, table.ownerId),
    check('budgets_currency_check', sql`${table.currency} in ('ARS', 'USD')`),
    index('budgets_owner_created_idx').on(table.ownerId, table.createdAt, table.id),
  ],
);

/** The values a budget holds from the first day of `effective_from` on; one row per month at most. */
export const budgetVersions = pgTable(
  'budget_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetId: uuid('budget_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    /** Minor units. */
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    rollover: boolean('rollover').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'budget_versions_budget_owner_fk',
      columns: [table.budgetId, table.ownerId],
      foreignColumns: [budgets.id, budgets.ownerId],
    }).onDelete('cascade'),
    unique('budget_versions_budget_effective_unique').on(table.budgetId, table.effectiveFrom),
    unique('budget_versions_id_owner_unique').on(table.id, table.ownerId),
    check(
      'budget_versions_effective_from_check',
      sql`extract(day from ${table.effectiveFrom}) = 1`,
    ),
    check('budget_versions_name_length_check', sql`char_length(${table.name}) between 1 and 50`),
    check('budget_versions_amount_check', sql`${table.amount} > 0`),
  ],
);

/** The selected categories of a version; subcategories are expanded on read, never stored. */
export const budgetVersionCategories = pgTable(
  'budget_version_categories',
  {
    versionId: uuid('version_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    /** Always `expense`: the composite key to categories makes the database refuse an income category. */
    kind: text('kind').notNull().default('expense'),
  },
  (table) => [
    primaryKey({
      name: 'budget_version_categories_pkey',
      columns: [table.versionId, table.categoryId],
    }),
    foreignKey({
      name: 'budget_version_categories_version_owner_fk',
      columns: [table.versionId, table.ownerId],
      foreignColumns: [budgetVersions.id, budgetVersions.ownerId],
    }).onDelete('cascade'),
    // No action: deleting a category a budget uses fails. The migration (0034) makes this key
    // DEFERRABLE INITIALLY DEFERRED by hand, which drizzle-kit cannot express: account erasure
    // cascades to the categories and to the budgets in separate internal statements, so only a
    // check at the end of the whole delete lets it succeed.
    foreignKey({
      name: 'budget_version_categories_category_owner_kind_fk',
      columns: [table.categoryId, table.ownerId, table.kind],
      foreignColumns: [categories.id, categories.ownerId, categories.kind],
    }).onDelete('no action'),
    check('budget_version_categories_kind_check', sql`${table.kind} = 'expense'`),
    index('budget_version_categories_category_idx').on(table.categoryId),
  ],
);

/** One alert percentage of a version; the range check is here, the count of 5 in the contract. */
export const budgetVersionThresholds = pgTable(
  'budget_version_thresholds',
  {
    versionId: uuid('version_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    percent: smallint('percent').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'budget_version_thresholds_pkey',
      columns: [table.versionId, table.percent],
    }),
    foreignKey({
      name: 'budget_version_thresholds_version_owner_fk',
      columns: [table.versionId, table.ownerId],
      foreignColumns: [budgetVersions.id, budgetVersions.ownerId],
    }).onDelete('cascade'),
    check('budget_version_thresholds_percent_check', sql`${table.percent} between 1 and 200`),
  ],
);

/**
 * Which threshold of which budget alerted in which month (DISC-001-06d). The unique key makes the
 * alert fire once; the composite key to `budgets` keeps a mark from pointing at another owner's budget.
 */
export const budgetAlertMarks = pgTable(
  'budget_alert_marks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetId: uuid('budget_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    /** The first day of the month. */
    month: date('month', { mode: 'string' }).notNull(),
    threshold: smallint('threshold').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'budget_alert_marks_budget_owner_fk',
      columns: [table.budgetId, table.ownerId],
      foreignColumns: [budgets.id, budgets.ownerId],
    }).onDelete('cascade'),
    unique('budget_alert_marks_budget_month_threshold_unique').on(
      table.budgetId,
      table.month,
      table.threshold,
    ),
    check('budget_alert_marks_threshold_check', sql`${table.threshold} between 1 and 200`),
    check('budget_alert_marks_month_check', sql`extract(day from ${table.month}) = 1`),
  ],
);
