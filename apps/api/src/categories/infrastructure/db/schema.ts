import { CATEGORY_COLORS, CATEGORY_KINDS, type CategoryIcon } from '@pesly/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// The foreign-key target is imported from the identity schema because drizzle-kit needs the
// reference to resolve.
import { users } from '../../../identity/infrastructure/db/schema';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    /** The composite foreign key below keeps a parent under the same owner and kind. */
    parentId: uuid('parent_id'),
    /** Set for defaults and kept after a rename. */
    defaultKey: text('default_key'),
    /** Null while a default is untouched: the client then shows the translated default name. */
    name: text('name'),
    icon: text('icon').$type<CategoryIcon>().notNull(),
    color: text('color', { enum: CATEGORY_COLORS }).notNull(),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('categories_id_owner_kind_unique').on(table.id, table.ownerId, table.kind),
    // MATCH SIMPLE: a root (parent_id null) is not constrained.
    foreignKey({
      name: 'categories_parent_owner_kind_fk',
      columns: [table.parentId, table.ownerId, table.kind],
      foreignColumns: [table.id, table.ownerId, table.kind],
    }).onDelete('restrict'),
    check('categories_kind_check', sql`${table.kind} in ('expense', 'income')`),
    check(
      'categories_default_key_length_check',
      sql`${table.defaultKey} is null or char_length(${table.defaultKey}) between 1 and 60`,
    ),
    // Mirrors the request validation (1 to 50 characters) as defence in depth (NFR-03).
    check(
      'categories_name_length_check',
      sql`${table.name} is null or char_length(${table.name}) between 1 and 50`,
    ),
    check(
      'categories_key_or_name_check',
      sql`${table.defaultKey} is not null or ${table.name} is not null`,
    ),
    check('categories_icon_length_check', sql`char_length(${table.icon}) between 1 and 40`),
    check('categories_color_length_check', sql`char_length(${table.color}) between 1 and 40`),
    uniqueIndex('categories_owner_default_key_unique')
      .on(table.ownerId, table.defaultKey)
      .where(sql`${table.defaultKey} is not null`),
    // Custom names only: an untouched default stores no name, and the application checks its
    // translations. The all-zero uuid stands in for "no parent" so roots collide with each other.
    uniqueIndex('categories_owner_name_unique')
      .on(
        table.ownerId,
        table.kind,
        sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000')`,
        sql`lower(${table.name})`,
      )
      .where(sql`${table.name} is not null`),
    index('categories_owner_kind_parent_idx').on(table.ownerId, table.kind, table.parentId),
    index('categories_owner_created_idx').on(table.ownerId, table.createdAt, table.id),
  ],
);

/** One row per user whose default set was created, so a deleted default is never recreated. */
export const categoryDefaultsSeeded = pgTable('category_defaults_seeded', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  seededAt: timestamptz('seeded_at').notNull().defaultNow(),
});
