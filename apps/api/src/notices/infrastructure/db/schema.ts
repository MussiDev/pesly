import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './foreign-relations';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * An in-app notice (DISC-001-08c): a reminder, or the result of an automatic recording. The text
 * is stored already rendered. `payment_id` has no foreign key on purpose: the notice outlives the
 * payment, as `movement_id` does in the recurring occurrences.
 */
export const notices = pgTable(
  'notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'reminder' | 'recorded' | 'not_recorded'>().notNull(),
    paymentId: uuid('payment_id').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    text: text('text').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    readAt: timestamptz('read_at'),
  },
  (table) => [
    check('notices_kind_check', sql`${table.kind} in ('reminder', 'recorded', 'not_recorded')`),
    check('notices_text_length_check', sql`char_length(${table.text}) between 1 and 300`),
    unique('notices_kind_payment_due_unique').on(table.kind, table.paymentId, table.dueDate),
    index('notices_owner_created_idx').on(table.ownerId, table.createdAt.desc(), table.id.desc()),
    index('notices_owner_unread_idx')
      .on(table.ownerId)
      .where(sql`${table.readAt} is null`),
  ],
);
