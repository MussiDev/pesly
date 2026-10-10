import { CATEGORY_COLORS, RATE_TYPES, type CategoryIcon } from '@pesly/shared';
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
import { users } from './foreign-relations';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const RATE_TYPE_LITERALS = sql.raw(RATE_TYPES.map((type) => `'${type}'`).join(', '));

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    defaultRateType: text('default_rate_type', { enum: RATE_TYPES }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Mirrors the request validation (1 to 50 characters) as defence in depth.
    check('groups_name_length_check', sql`char_length(${table.name}) between 1 and 50`),
    check(
      'groups_default_rate_type_check',
      sql`${table.defaultRateType} in (${RATE_TYPE_LITERALS})`,
    ),
  ],
);

/**
 * A registered member has `user_id`; a ghost has only `display_name`. The member keeps its `id`
 * and `joined_at` when a ghost is claimed (spec D2).
 */
export const groupMembers = pgTable(
  'group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    // Restrict: account erasure converts the membership first (spec D10).
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    displayName: text('display_name'),
    role: text('role', { enum: ['admin', 'member'] })
      .notNull()
      .default('member'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'group_members_display_name_length_check',
      sql`${table.displayName} is null or char_length(${table.displayName}) between 1 and 50`,
    ),
    check('group_members_role_check', sql`${table.role} in ('admin', 'member')`),
    check(
      'group_members_user_or_name_check',
      sql`${table.userId} is not null or ${table.displayName} is not null`,
    ),
    check(
      'group_members_not_both_check',
      sql`${table.userId} is null or ${table.displayName} is null`,
    ),
    // A ghost cannot be an admin (spec D2).
    check(
      'group_members_admin_registered_check',
      sql`${table.role} = 'member' or ${table.userId} is not null`,
    ),
    // The target of the composite keys of invitations and claim links.
    unique('group_members_id_group_unique').on(table.id, table.groupId),
    uniqueIndex('group_members_group_user_unique')
      .on(table.groupId, table.userId)
      .where(sql`${table.userId} is not null`),
    index('group_members_user_idx').on(table.userId),
    index('group_members_group_joined_idx').on(table.groupId, table.joinedAt, table.id),
  ],
);

/** Only the SHA-256 of the token is stored (spec D3). One row per creating member (spec D16). */
export const groupInvitations = pgTable(
  'group_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('group_invitations_token_hash_unique').on(table.tokenHash),
    unique('group_invitations_created_by_member_unique').on(table.createdByMemberId),
    foreignKey({
      name: 'group_invitations_creator_group_fk',
      columns: [table.createdByMemberId, table.groupId],
      foreignColumns: [groupMembers.id, groupMembers.groupId],
    }).onDelete('cascade'),
    index('group_invitations_group_idx').on(table.groupId),
  ],
);

/** A single-use link to claim a ghost member; at most one unused link per ghost (spec D5). */
export const groupClaimLinks = pgTable(
  'group_claim_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('group_claim_links_token_hash_unique').on(table.tokenHash),
    foreignKey({
      name: 'group_claim_links_member_group_fk',
      columns: [table.memberId, table.groupId],
      foreignColumns: [groupMembers.id, groupMembers.groupId],
    }).onDelete('cascade'),
    uniqueIndex('group_claim_links_member_unused_unique')
      .on(table.memberId)
      .where(sql`${table.usedAt} is null`),
  ],
);

/** The group's own expense categories: top level, expense only, archived and never deleted (D8). */
export const groupCategories = pgTable(
  'group_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
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
    check(
      'group_categories_default_key_length_check',
      sql`${table.defaultKey} is null or char_length(${table.defaultKey}) between 1 and 60`,
    ),
    check(
      'group_categories_name_length_check',
      sql`${table.name} is null or char_length(${table.name}) between 1 and 50`,
    ),
    check(
      'group_categories_key_or_name_check',
      sql`${table.defaultKey} is not null or ${table.name} is not null`,
    ),
    check('group_categories_icon_length_check', sql`char_length(${table.icon}) between 1 and 40`),
    check('group_categories_color_length_check', sql`char_length(${table.color}) between 1 and 40`),
    uniqueIndex('group_categories_group_default_key_unique')
      .on(table.groupId, table.defaultKey)
      .where(sql`${table.defaultKey} is not null`),
    // Custom names only: an untouched default stores no name, and the application checks its
    // translations.
    uniqueIndex('group_categories_group_name_unique')
      .on(table.groupId, sql`lower(${table.name})`)
      .where(sql`${table.name} is not null`),
    index('group_categories_group_created_idx').on(table.groupId, table.createdAt, table.id),
  ],
);
