import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './foreign-relations';
import { movements } from './schema';

/**
 * One row per distinct tag of a user; `name` keeps the spelling of the first use, while
 * comparison, suggestions and filters use `lower(name)`.
 */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // The target of the composite key of movement_tags, so a link cannot cross owners.
    unique('tags_id_owner_unique').on(table.id, table.ownerId),
    check('tags_name_length_check', sql`char_length(${table.name}) between 1 and 30`),
    uniqueIndex('tags_owner_name_unique').on(table.ownerId, sql`lower(${table.name})`),
    // text_pattern_ops lets `like 'prefix%'` use the index whatever the database collation is.
    index('tags_owner_name_prefix_idx').on(
      table.ownerId,
      sql`lower(${table.name}) text_pattern_ops`,
    ),
  ],
);

/** Links a movement to up to 10 tags; both keys carry the owner, so the database keeps them equal. */
export const movementTags = pgTable(
  'movement_tags',
  {
    movementId: uuid('movement_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    position: smallint('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.movementId, table.tagId] }),
    unique('movement_tags_movement_id_position_unique').on(table.movementId, table.position),
    check('movement_tags_position_check', sql`${table.position} between 0 and 9`),
    foreignKey({
      name: 'movement_tags_movement_owner_fk',
      columns: [table.movementId, table.ownerId],
      foreignColumns: [movements.id, movements.ownerId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'movement_tags_tag_owner_fk',
      columns: [table.tagId, table.ownerId],
      foreignColumns: [tags.id, tags.ownerId],
    }).onDelete('cascade'),
    index('movement_tags_tag_idx').on(table.tagId, table.movementId),
  ],
);
