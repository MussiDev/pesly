import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, users } from './foreign-relations';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * A savings goal (DISC-001-06a). Progress is never stored: for a linked goal it is the balance of
 * the linked account, for any other goal the sum of its entries. The link is set at creation only.
 */
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetAmount: bigint('target_amount', { mode: 'bigint' }).notNull(),
    currency: text('currency').$type<'ARS' | 'USD'>().notNull(),
    targetDate: date('target_date', { mode: 'string' }),
    linkedAccountId: uuid('linked_account_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('goals_name_length_check', sql`char_length(${table.name}) between 1 and 80`),
    check('goals_target_amount_check', sql`${table.targetAmount} > 0`),
    check('goals_currency_check', sql`${table.currency} in ('ARS', 'USD')`),
    // The owner is part of the key, so a goal can only link to its own owner's account, and the
    // account cannot be deleted while a goal links to it. A null link skips the key.
    foreignKey({
      name: 'goals_account_owner_fk',
      columns: [table.linkedAccountId, table.ownerId],
      foreignColumns: [accounts.id, accounts.ownerId],
    }).onDelete('restrict'),
    // The target of the entries' composite key.
    unique('goals_id_owner_unique').on(table.id, table.ownerId),
    index('goals_owner_created_idx').on(table.ownerId, table.createdAt, table.id),
    index('goals_linked_account_idx')
      .on(table.linkedAccountId)
      .where(sql`${table.linkedAccountId} is not null`),
  ],
);

/** A manual contribution to or withdrawal from a goal that is not linked to an account. */
export const goalEntries = pgTable(
  'goal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goalId: uuid('goal_id').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'contribution' | 'withdrawal'>().notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('goal_entries_kind_check', sql`${table.kind} in ('contribution', 'withdrawal')`),
    check('goal_entries_amount_check', sql`${table.amount} > 0`),
    foreignKey({
      name: 'goal_entries_goal_owner_fk',
      columns: [table.goalId, table.ownerId],
      foreignColumns: [goals.id, goals.ownerId],
    }).onDelete('cascade'),
    index('goal_entries_goal_created_idx').on(table.goalId, table.createdAt, table.id),
    index('goal_entries_owner_idx').on(table.ownerId),
  ],
);
