import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { notices, users } from './foreign-relations';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * A browser push subscription (DISC-001-08d). The endpoint is the key and belongs to the last user
 * who stored it; it is secret-like, so it is never logged.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'push_subscriptions_endpoint_length_check',
      sql`char_length(${table.endpoint}) between 1 and 2048`,
    ),
    check('push_subscriptions_p256dh_length_check', sql`char_length(${table.p256dh}) = 87`),
    check('push_subscriptions_auth_length_check', sql`char_length(${table.auth}) = 22`),
    unique('push_subscriptions_endpoint_unique').on(table.endpoint),
    index('push_subscriptions_user_updated_idx').on(
      table.userId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
  ],
);

/** One push of one notice to one subscription; the unique pair makes the fan-out idempotent. */
export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noticeId: uuid('notice_id')
      .notNull()
      .references(() => notices.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: 'cascade' }),
    status: text('status')
      .$type<'pending' | 'sent' | 'failed' | 'skipped'>()
      .notNull()
      .default('pending'),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    leaseUntil: timestamptz('lease_until'),
    sentAt: timestamptz('sent_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'push_deliveries_status_check',
      sql`${table.status} in ('pending', 'sent', 'failed', 'skipped')`,
    ),
    check('push_deliveries_attempts_check', sql`${table.attempts} between 0 and 5`),
    unique('push_deliveries_notice_subscription_unique').on(table.noticeId, table.subscriptionId),
    index('push_deliveries_due_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index('push_deliveries_subscription_idx').on(table.subscriptionId),
    index('push_deliveries_done_idx')
      .on(table.updatedAt)
      .where(sql`${table.status} <> 'pending'`),
  ],
);
