import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrizzleDeletionGrantRepository } from '../../src/identity/infrastructure/db/drizzle-deletion-grant-repository';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { eraseUserCreditCards } from '../../src/credit-cards';
import { eraseUserGroups } from '../../src/groups';
import { eraseUserMovements } from '../../src/movements';
import { eraseUserRecurring } from '../../src/recurring';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
import {
  deleteAccount,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { seedTwoFactor, totpNow } from '../helpers/two-factor-client';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const FIVE_MINUTES = 5 * 60 * 1000;
const NOW = new Date('2026-10-02T12:00:00.000Z');
const FIXTURE_SCHEMA = new URL('../fixtures/fixture-schema.sql', import.meta.url);
const FAMILY = 'f0000000-0000-4000-8000-0000000000e1';

/**
 * What a seeder needs; `state` carries what one seeder hands to the next (the 2FA secret).
 */
interface SeedContext {
  connection: DatabaseConnection;
  userId: string;
  email: string;
  harness: IdentityHarness;
  state: { secret?: string };
}

/**
 * `cascade`: the rows go with the user through `ON DELETE CASCADE`.
 * `erase-step`: the module deletes the rows in an ordered step that runs before the user is
 * deleted, because its keys to other tables restrict; only the constraints named on the entry may
 * be non-cascading. A module that needs another action adds a policy here and a step in its ticket.
 */
type ErasurePolicy = 'cascade' | 'erase-step';

interface RegisteredTable {
  table: string;
  /** The column that holds the owner's user id. */
  userColumn: string;
  policy: ErasurePolicy;
  /** For `erase-step`: the constraints of this table that may be non-cascading. */
  stepConstraints?: readonly string[];
  /** Counts the user's rows when the table has no user column; `$1` is the user id. */
  rowsSql?: string;
  /** The rows belong to a group, which outlives its former member (the member row becomes a ghost). */
  survivesErasure?: boolean;
  /** Creates one real row for the user. */
  seed: (context: SeedContext) => Promise<void>;
}

/** The restricting composite keys from `credit_cards` to the linked and debit accounts (migrations 0019, 0029). */
const CREDIT_CARDS_STEP_CONSTRAINTS = [
  'credit_cards_ars_account_owner_fk',
  'credit_cards_usd_account_owner_fk',
  'credit_cards_debit_ars_account_owner_fk',
  'credit_cards_debit_usd_account_owner_fk',
] as const;

/** The restricting composite keys from `installment_purchases` to the card and the category (migration 0020). */
const INSTALLMENT_PURCHASES_STEP_CONSTRAINTS = [
  'installment_purchases_card_owner_fk',
  'installment_purchases_category_owner_kind_fk',
] as const;

/** The restricting composite keys from `recurring_payments` to the account and the category (migration 0023). */
const RECURRING_PAYMENTS_STEP_CONSTRAINTS = [
  'recurring_payments_account_owner_fk',
  'recurring_payments_category_owner_fk',
] as const;

/** The restricting key from `group_members` to users (migration 0026); the step turns the member into a ghost. */
const GROUP_MEMBERS_STEP_CONSTRAINTS = ['group_members_user_id_users_id_fk'] as const;

/** The restricting member keys and the set-null movement key of `group_expenses` (migration 0027). */
const GROUP_EXPENSES_STEP_CONSTRAINTS = [
  'group_expenses_payer_group_fk',
  'group_expenses_creator_group_fk',
  'group_expenses_payer_movement_id_movements_id_fk',
] as const;

/** The restricting member key of `group_expense_shares` (migration 0027). */
const GROUP_EXPENSE_SHARES_STEP_CONSTRAINTS = ['group_expense_shares_member_group_fk'] as const;

/** The restricting member key of `group_activity_log` (migration 0027). */
const GROUP_ACTIVITY_LOG_STEP_CONSTRAINTS = ['group_activity_log_member_group_fk'] as const;

/** The restricting member keys and the set-null account key of `group_settlements` (migration 0028). */
const GROUP_SETTLEMENTS_STEP_CONSTRAINTS = [
  'group_settlements_from_group_fk',
  'group_settlements_to_group_fk',
  'group_settlements_creator_group_fk',
  'group_settlements_account_member_group_fk',
  'group_settlements_account_id_accounts_id_fk',
] as const;

/** The name of the group a seeder creates for one user, so rows without a user column can be counted. */
const groupNameFor = (userId: string): string => `erasure-${userId}`;

const GROUP_ROWS_SQL = (table: string): string =>
  `select count(*) as n from ${table} t join groups g on g.id = t.group_id where g.name = 'erasure-' || $1::text`;

/** The restricting composite keys of `movements` (migrations 0014 and 0016). */
const MOVEMENTS_STEP_CONSTRAINTS = [
  'movements_account_owner_fk',
  'movements_category_owner_kind_fk',
  'movements_destination_owner_fk',
] as const;

const query = (context: SeedContext, statement: string, params: unknown[]) =>
  context.connection.pool.query(statement, params);

/**
 * Every table that stores user data, with one seeder each. A table that becomes reachable from
 * `users` through a foreign key must be added here (DISC-001-02b categories, DISC-001-07a, the
 * movements of PRD 03): the guard below fails until it is.
 */
const REGISTRY: readonly RegisteredTable[] = [
  {
    table: 'accounts',
    userColumn: 'owner_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(
        context,
        "insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ($1, 'Caja', 'cash', 'ARS', 0, true)",
        [context.userId],
      );
    },
  },
  {
    table: 'one_time_tokens',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(
        context,
        "insert into one_time_tokens (id, user_id, purpose, token_hash, expires_at) values ($1, $2, 'password_reset', $3, $4)",
        [randomUUID(), context.userId, `ott-${context.userId}`, NOW],
      );
    },
  },
  {
    table: 'sessions',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      await new DrizzleSessionRepository(context.connection.db).create({
        userId: context.userId,
        familyId: randomUUID(),
        refreshTokenHash: `rt-${randomUUID()}`,
        credentialsVersion: 0,
        lastUsedAt: NOW,
      });
    },
  },
  {
    table: 'user_identities',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(
        context,
        "insert into user_identities (user_id, provider, subject, email_authoritative) values ($1, 'google', $2, true)",
        [context.userId, `sub-${context.userId}`],
      );
    },
  },
  {
    table: 'user_two_factor',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      const { secret } = await seedTwoFactor(
        context.connection,
        context.userId,
        context.harness.clock,
      );
      context.state.secret = secret;
    },
  },
  {
    table: 'recovery_codes',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(context, 'insert into recovery_codes (user_id, code_hash) values ($1, $2)', [
        context.userId,
        `extra-${context.userId}`,
      ]);
    },
  },
  {
    table: 'sign_in_challenges',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(
        context,
        "insert into sign_in_challenges (token_hash, user_id, credentials_version, via, language, expires_at) values ($1, $2, 0, 'password', 'es', $3)",
        [`sic-${context.userId}`, context.userId, NOW],
      );
    },
  },
  {
    table: 'oauth_states',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      await new DrizzleOAuthStateRepository(context.connection.db).create({
        stateHash: `state-${context.userId}`,
        bindingHash: 'binding',
        nonceHash: 'nonce',
        codeVerifier: 'verifier',
        timeZone: 'UTC',
        language: 'es',
        purpose: 'delete_account',
        userId: context.userId,
        sessionFamilyId: FAMILY,
        expiresAt: new Date(NOW.getTime() + FIVE_MINUTES),
      });
    },
  },
  {
    table: 'deletion_grants',
    userColumn: 'user_id',
    policy: 'cascade',
    seed: async (context) => {
      await new DrizzleDeletionGrantRepository(context.connection.db).replace({
        tokenHash: `grant-${context.userId}`,
        userId: context.userId,
        sessionFamilyId: FAMILY,
        credentialsVersion: 0,
        expiresAt: new Date(NOW.getTime() + FIVE_MINUTES),
      });
    },
  },
  {
    table: 'categories',
    userColumn: 'owner_id',
    policy: 'cascade',
    // A parent and a child, so the erasure also crosses the self-referencing key of the tree.
    seed: async (context) => {
      const parentId = randomUUID();
      await query(
        context,
        "insert into categories (id, owner_id, kind, name, icon, color) values ($1, $2, 'expense', 'Parent', 'tag', 'blue')",
        [parentId, context.userId],
      );
      await query(
        context,
        "insert into categories (owner_id, kind, parent_id, name, icon, color) values ($1, 'expense', $2, 'Child', 'tag', 'blue')",
        [context.userId, parentId],
      );
    },
  },
  {
    table: 'category_defaults_seeded',
    userColumn: 'owner_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(context, 'insert into category_defaults_seeded (owner_id) values ($1)', [
        context.userId,
      ]);
    },
  },
  {
    table: 'movements',
    userColumn: 'owner_id',
    policy: 'erase-step',
    // The composite keys to the owner's accounts and categories restrict, so the step deletes the
    // movements first; the key to users itself cascades.
    stepConstraints: MOVEMENTS_STEP_CONSTRAINTS,
    // Registered after accounts and categories. A second account (the accounts seeder uses
    // `Caja`) and a category of the same kind as the movement.
    seed: async (context) => {
      const account = await query(
        context,
        "insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ($1, 'Movements account', 'cash', 'ARS', 0, true) returning id",
        [context.userId],
      );
      const category = await query(
        context,
        "insert into categories (owner_id, kind, name, icon, color) values ($1, 'expense', 'Movements category', 'tag', 'blue') returning id",
        [context.userId],
      );
      await query(
        context,
        "insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source) values ($1, 'expense', $2, $3, 1000, $4, 10000, 'manual')",
        [
          context.userId,
          (account.rows[0] as { id: string }).id,
          (category.rows[0] as { id: string }).id,
          NOW,
        ],
      );
    },
  },
  {
    table: 'movement_rate_limits',
    userColumn: 'owner_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(
        context,
        'insert into movement_rate_limits (owner_id, window_start, count) values ($1, $2, 1)',
        [context.userId, NOW],
      );
    },
  },
  {
    table: 'tags',
    userColumn: 'owner_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(context, "insert into tags (owner_id, name) values ($1, 'Trip')", [
        context.userId,
      ]);
    },
  },
  {
    table: 'movement_tags',
    userColumn: 'owner_id',
    policy: 'cascade',
    // Registered after movements and tags: its own movement and tag, under the same owner.
    seed: async (context) => {
      const account = await query(
        context,
        "insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ($1, 'Tags account', 'cash', 'ARS', 0, true) returning id",
        [context.userId],
      );
      const category = await query(
        context,
        "insert into categories (owner_id, kind, name, icon, color) values ($1, 'expense', 'Tags category', 'tag', 'blue') returning id",
        [context.userId],
      );
      const movement = await query(
        context,
        "insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source) values ($1, 'expense', $2, $3, 1000, $4, 10000, 'manual') returning id",
        [
          context.userId,
          (account.rows[0] as { id: string }).id,
          (category.rows[0] as { id: string }).id,
          NOW,
        ],
      );
      const tag = await query(
        context,
        "insert into tags (owner_id, name) values ($1, 'Linked') returning id",
        [context.userId],
      );
      await query(
        context,
        'insert into movement_tags (movement_id, tag_id, owner_id, position) values ($1, $2, $3, 0)',
        [
          (movement.rows[0] as { id: string }).id,
          (tag.rows[0] as { id: string }).id,
          context.userId,
        ],
      );
    },
  },
  {
    table: 'portfolios',
    userColumn: 'owner_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(context, "insert into portfolios (owner_id, name) values ($1, 'Balanz')", [
        context.userId,
      ]);
    },
  },
  {
    table: 'holdings',
    userColumn: 'owner_id',
    policy: 'cascade',
    // Registered after portfolios: the holding hangs from the user's portfolio.
    seed: async (context) => {
      await query(
        context,
        `insert into holdings (portfolio_id, owner_id, ticker, instrument_name, instrument_type, quantity, valuation_currency)
         select id, owner_id, 'AAPL', 'Apple', 'cedear', 1000000000, 'ARS'
         from portfolios where owner_id = $1 order by created_at, id limit 1`,
        [context.userId],
      );
    },
  },
  {
    table: 'portfolio_value_snapshots',
    userColumn: 'owner_id',
    policy: 'cascade',
    // Registered after portfolios: the snapshot hangs from the user's portfolio. The market price
    // table is deliberately absent: it has no foreign key and holds no user data.
    seed: async (context) => {
      await query(
        context,
        `insert into portfolio_value_snapshots (portfolio_id, owner_id, snapshot_date, currency, total_value, taken_at)
         select id, owner_id, '2026-10-01', 'ARS', 1500000, now()
         from portfolios where owner_id = $1 order by created_at, id limit 1`,
        [context.userId],
      );
    },
  },
  {
    table: 'credit_cards',
    userColumn: 'owner_id',
    policy: 'erase-step',
    // The keys to the two linked accounts restrict, so the step deletes the cards before the
    // accounts go; the key to users itself cascades.
    stepConstraints: CREDIT_CARDS_STEP_CONSTRAINTS,
    seed: async (context) => {
      const linked = await query(
        context,
        "insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ($1, 'Card ARS', 'credit_card', 'ARS', 0, false), ($1, 'Card USD', 'credit_card', 'USD', 0, false) returning id, currency",
        [context.userId],
      );
      const rows = linked.rows as { id: string; currency: string }[];
      await query(
        context,
        "insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id) values ($1, 'Card', 24, 5, $2, $3)",
        [
          context.userId,
          rows.find((row) => row.currency === 'ARS')?.id,
          rows.find((row) => row.currency === 'USD')?.id,
        ],
      );
    },
  },
  {
    table: 'credit_card_statements',
    userColumn: 'owner_id',
    policy: 'cascade',
    // Registered after credit_cards: the statement belongs to the card that seeder created.
    seed: async (context) => {
      await query(
        context,
        "insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date) select id, owner_id, '2026-10', '2026-10-24', '2026-11-05' from credit_cards where owner_id = $1 limit 1",
        [context.userId],
      );
    },
  },
  {
    table: 'card_statement_import_lines',
    userColumn: 'owner_id',
    policy: 'cascade',
    // Registered after credit_cards: the fingerprint belongs to the card that seeder created.
    seed: async (context) => {
      await query(
        context,
        "insert into card_statement_import_lines (owner_id, card_id, fingerprint) select owner_id, id, repeat('a', 64) from credit_cards where owner_id = $1 limit 1",
        [context.userId],
      );
    },
  },
  {
    table: 'card_automatic_debits',
    userColumn: 'owner_id',
    policy: 'cascade',
    // Registered after credit_cards: the claim belongs to the card that seeder created.
    seed: async (context) => {
      await query(
        context,
        "insert into card_automatic_debits (card_id, owner_id, period, currency, status) select id, owner_id, '2026-10', 'ARS', 'pending' from credit_cards where owner_id = $1 limit 1",
        [context.userId],
      );
    },
  },
  {
    table: 'installment_purchases',
    userColumn: 'owner_id',
    policy: 'erase-step',
    // The keys to the card and the category restrict, so the step deletes the purchases before
    // the cards go; the key to users itself cascades.
    stepConstraints: INSTALLMENT_PURCHASES_STEP_CONSTRAINTS,
    seed: async (context) => {
      await query(
        context,
        "insert into categories (owner_id, kind, name, icon, color) values ($1, 'expense', 'Cuotas', 'wallet', 'blue')",
        [context.userId],
      );
      await query(
        context,
        "insert into installment_purchases (owner_id, card_id, category_id, total_amount, installment_count, purchased_on) select c.owner_id, c.id, (select id from categories where owner_id = $1 and name = 'Cuotas'), 20000, 2, '2026-10-01' from credit_cards c where c.owner_id = $1 limit 1",
        [context.userId],
      );
    },
  },
  {
    table: 'installments',
    userColumn: 'owner_id',
    policy: 'cascade',
    seed: async (context) => {
      await query(
        context,
        "insert into installments (purchase_id, owner_id, number, period, amount) select id, owner_id, 1, '2026-10', 10000 from installment_purchases where owner_id = $1 limit 1",
        [context.userId],
      );
    },
  },
  {
    table: 'recurring_payments',
    userColumn: 'owner_id',
    policy: 'erase-step',
    // The keys to the account and the category restrict, so the step deletes the payments before
    // those go; the key to users itself cascades.
    stepConstraints: RECURRING_PAYMENTS_STEP_CONSTRAINTS,
    seed: async (context) => {
      const account = await query(
        context,
        "insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ($1, 'Recurring account', 'cash', 'ARS', 0, true) returning id",
        [context.userId],
      );
      const category = await query(
        context,
        "insert into categories (owner_id, kind, name, icon, color) values ($1, 'expense', 'Recurring', 'wallet', 'blue') returning id",
        [context.userId],
      );
      await query(
        context,
        "insert into recurring_payments (owner_id, name, amount, account_id, category_id, frequency, day_of_month, start_date, mode, schedule_from, auto_recording_from) values ($1, 'Rent', 35000000, $2, $3, 'monthly', 5, '2026-10-05', 'automatic', '2026-10-05', '2026-10-05')",
        [
          context.userId,
          (account.rows[0] as { id: string }).id,
          (category.rows[0] as { id: string }).id,
        ],
      );
    },
  },
  {
    table: 'recurring_occurrences',
    userColumn: 'owner_id',
    policy: 'cascade',
    // Registered after recurring_payments: the occurrence belongs to the payment that seeder created.
    seed: async (context) => {
      await query(
        context,
        "insert into recurring_occurrences (payment_id, owner_id, due_date) select id, owner_id, '2026-10-05' from recurring_payments where owner_id = $1 limit 1",
        [context.userId],
      );
    },
  },
  {
    table: 'notices',
    userColumn: 'owner_id',
    policy: 'cascade',
    // No foreign key to the payment, so the notice needs no seeded payment of its own.
    seed: async (context) => {
      await query(
        context,
        "insert into notices (owner_id, kind, payment_id, due_date, text) values ($1, 'reminder', gen_random_uuid(), '2026-10-05', 'Rent is due tomorrow')",
        [context.userId],
      );
    },
  },
  {
    table: 'group_members',
    userColumn: 'user_id',
    policy: 'erase-step',
    // The key to users restricts, so the step turns the membership into a ghost before the user goes.
    stepConstraints: GROUP_MEMBERS_STEP_CONSTRAINTS,
    seed: async (context) => {
      const group = await query(
        context,
        "insert into groups (name, default_rate_type) values ($1, 'blue') returning id",
        [groupNameFor(context.userId)],
      );
      const groupId = (group.rows[0] as { id: string }).id;
      await query(
        context,
        "insert into group_members (group_id, user_id, role) values ($1, $2, 'admin')",
        [groupId, context.userId],
      );
      await query(
        context,
        "insert into group_members (group_id, display_name) values ($1, 'Ghost')",
        [groupId],
      );
    },
  },
  {
    table: 'group_invitations',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_invitations'),
    policy: 'cascade',
    survivesErasure: true,
    // Registered after group_members: the invitation was created by the member that seeder created.
    seed: async (context) => {
      await query(
        context,
        `insert into group_invitations (group_id, token_hash, created_by_member_id, expires_at)
         select m.group_id, $2, m.id, $3 from group_members m where m.user_id = $1`,
        [context.userId, `invitation-${context.userId}`, new Date('2026-12-01T00:00:00.000Z')],
      );
    },
  },
  {
    table: 'group_claim_links',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_claim_links'),
    policy: 'cascade',
    survivesErasure: true,
    // Registered after group_members: the link is for the ghost member that seeder created.
    seed: async (context) => {
      await query(
        context,
        `insert into group_claim_links (group_id, member_id, token_hash)
         select m.group_id, m.id, $2 from group_members m
         join group_members u on u.group_id = m.group_id and u.user_id = $1
         where m.display_name = 'Ghost'`,
        [context.userId, `claim-${context.userId}`],
      );
    },
  },
  {
    table: 'group_expenses',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_expenses'),
    policy: 'erase-step',
    survivesErasure: true,
    // The member keys restrict because the step turns the member into a ghost instead of deleting
    // it; the movement key sets null, so the expense outlives the erased account (migration 0027).
    stepConstraints: GROUP_EXPENSES_STEP_CONSTRAINTS,
    // Registered after group_members: the expense is paid by the member that seeder created.
    seed: async (context) => {
      await query(
        context,
        `with category as (
           insert into group_categories (group_id, default_key, icon, color)
           select m.group_id, 'food', 'utensils', 'red' from group_members m where m.user_id = $1
           returning id, group_id
         )
         insert into group_expenses
           (group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
            category_id, description, split_mode)
         select m.group_id, m.id, m.id, 1000, 'ARS', now(), c.id, 'Dinner', 'equal'
         from group_members m join category c on c.group_id = m.group_id
         where m.user_id = $1`,
        [context.userId],
      );
    },
  },
  {
    table: 'group_expense_shares',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_expense_shares'),
    policy: 'erase-step',
    survivesErasure: true,
    stepConstraints: GROUP_EXPENSE_SHARES_STEP_CONSTRAINTS,
    seed: async (context) => {
      await query(
        context,
        `insert into group_expense_shares (expense_id, member_id, group_id, amount)
         select e.id, m.id, e.group_id, 1000
         from group_expenses e join group_members m on m.id = e.payer_member_id
         where m.user_id = $1`,
        [context.userId],
      );
    },
  },
  {
    table: 'group_default_split_shares',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_default_split_shares'),
    policy: 'cascade',
    survivesErasure: true,
    seed: async (context) => {
      await query(
        context,
        `insert into group_default_split_shares (group_id, member_id, basis_points)
         select m.group_id, m.id, 10000 from group_members m where m.user_id = $1`,
        [context.userId],
      );
    },
  },
  {
    table: 'group_activity_log',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_activity_log'),
    policy: 'erase-step',
    survivesErasure: true,
    stepConstraints: GROUP_ACTIVITY_LOG_STEP_CONSTRAINTS,
    seed: async (context) => {
      await query(
        context,
        `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
         select e.group_id, e.payer_member_id, 'expense_created', e.id, now()
         from group_expenses e join group_members m on m.id = e.payer_member_id
         where m.user_id = $1`,
        [context.userId],
      );
    },
  },
  {
    table: 'group_settlements',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_settlements'),
    policy: 'erase-step',
    survivesErasure: true,
    // The member keys restrict because the step turns the member into a ghost instead of deleting
    // it; the account key sets null, so the settlement outlives the erased account (migration 0028).
    stepConstraints: GROUP_SETTLEMENTS_STEP_CONSTRAINTS,
    // Registered after group_members: the ghost the seeder created pays the user.
    seed: async (context) => {
      await query(
        context,
        `insert into group_settlements
           (group_id, from_member_id, to_member_id, created_by_member_id, currency, amount, occurred_at)
         select u.group_id, g.id, u.id, u.id, 'ARS', 500, now()
         from group_members u
         join group_members g on g.group_id = u.group_id and g.display_name = 'Ghost'
         where u.user_id = $1`,
        [context.userId],
      );
    },
  },
  {
    table: 'group_settlement_legs',
    userColumn: 'group_id',
    rowsSql: GROUP_ROWS_SQL('group_settlement_legs'),
    policy: 'cascade',
    survivesErasure: true,
    seed: async (context) => {
      await query(
        context,
        `insert into group_settlement_legs (settlement_id, group_id, currency, amount)
         select s.id, s.group_id, 'ARS', 500
         from group_settlements s join group_members m on m.id = s.to_member_id
         where m.user_id = $1`,
        [context.userId],
      );
    },
  },
];

/** Created by the access-control tests and never dropped; they are not user data of the product. */
const TEST_ONLY_TABLES = ['test_fixture_resources', 'test_fixture_group_members'] as const;

interface ForeignKey {
  constraint: string;
  child: string;
  parent: string;
  /** `pg_constraint.confdeltype`: `c` is `ON DELETE CASCADE`. */
  deleteAction: string;
}

/** Every foreign key on the paths that start at `users`, direct or through other tables. */
async function foreignKeysFromUsers(pool: pg.Pool): Promise<ForeignKey[]> {
  const result = await pool.query<{
    constraint: string;
    child: string;
    parent: string;
    delete_action: string;
  }>(
    `with recursive edges as (
       select con.conname, con.conrelid, con.confrelid, con.confdeltype
       from pg_constraint con
       join pg_class child on child.oid = con.conrelid
       join pg_namespace ns on ns.oid = child.relnamespace
       where con.contype = 'f'
         and ns.nspname = 'public'
         and child.relname <> all($1::text[])
     ), reach as (
       select e.* from edges e where e.confrelid = 'public.users'::regclass
       union
       select e.* from edges e join reach r on e.confrelid = r.conrelid
     )
     select distinct r.conname as constraint,
            child.relname as child,
            parent.relname as parent,
            r.confdeltype::text as delete_action
     from reach r
     join pg_class child on child.oid = r.conrelid
     join pg_class parent on parent.oid = r.confrelid
     order by child.relname, r.conname`,
    [[...TEST_ONLY_TABLES]],
  );
  return result.rows.map((row) => ({
    constraint: row.constraint,
    child: row.child,
    parent: row.parent,
    deleteAction: row.delete_action,
  }));
}

/** What is wrong with the foreign-key graph from `users`, as readable lines; empty when sound. */
async function guardViolations(
  pool: pg.Pool,
  registry: readonly RegisteredTable[] = REGISTRY,
): Promise<string[]> {
  const registered = new Set(registry.map((entry) => entry.table));
  const violations: string[] = [];
  const keys = await foreignKeysFromUsers(pool);
  for (const key of keys) {
    if (!registered.has(key.child)) {
      violations.push(
        `table ${key.child} (key ${key.constraint}) is reachable from users but not registered`,
      );
    }
    // A self-referencing key (the category tree) restricts only rows of the same owner, which the
    // cascade from users removes together. A key named on an `erase-step` entry restricts because
    // the module's step deletes those rows first. Every other key must cascade, so a later
    // accidental `restrict` on the same table fails here.
    const entry = registry.find((candidate) => candidate.table === key.child);
    const namedByStep =
      entry?.policy === 'erase-step' && (entry.stepConstraints ?? []).includes(key.constraint);
    if (key.deleteAction !== 'c' && key.child !== key.parent && !namedByStep) {
      violations.push(`key ${key.constraint} of ${key.child} does not cascade on delete`);
    }
  }
  const reachable = new Set(keys.map((key) => key.child));
  for (const entry of registry) {
    if (!reachable.has(entry.table)) {
      violations.push(`registered table ${entry.table} is not reachable from users`);
    }
  }
  return violations;
}

async function rowsFor(entry: RegisteredTable, userId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    entry.rowsSql ?? `select count(*) as n from ${entry.table} where ${entry.userColumn} = $1`,
    [userId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe('the erasure guard (NFR-01)', () => {
  it('has every table reachable from users in the registry, each with a cascading key', async () => {
    expect(await guardViolations(connection.pool)).toEqual([]);
  });

  it('discovers the direct and the indirect references of users', async () => {
    const keys = await foreignKeysFromUsers(connection.pool);

    expect(keys.map((key) => key.child)).toEqual(
      expect.arrayContaining(REGISTRY.map((entry) => entry.table)),
    );
    expect(keys.map((key) => key.child)).not.toContain('test_fixture_resources');
    expect(keys.map((key) => key.child)).not.toContain('test_fixture_group_members');
  });

  it('fails for a table with a foreign key to users that is not registered (error, sad path)', async () => {
    await connection.pool.query('drop table if exists erasure_guard_probe');
    await connection.pool.query(
      'create table erasure_guard_probe (id uuid primary key, user_id uuid references users (id) on delete cascade)',
    );
    try {
      const violations = await guardViolations(connection.pool);

      expect(violations).toEqual([expect.stringContaining('table erasure_guard_probe')]);
    } finally {
      await connection.pool.query('drop table if exists erasure_guard_probe');
    }
  });

  it('fails for a table that references a registered table, reaching users indirectly (error, sad path)', async () => {
    await connection.pool.query('drop table if exists erasure_guard_probe');
    await connection.pool.query(
      'create table erasure_guard_probe (id uuid primary key, session_id uuid references sessions (id) on delete cascade)',
    );
    try {
      const violations = await guardViolations(connection.pool);

      expect(violations).toEqual([expect.stringContaining('table erasure_guard_probe')]);
    } finally {
      await connection.pool.query('drop table if exists erasure_guard_probe');
    }
  });

  it('fails for a foreign key that does not cascade, even on a registered table (error, sad path)', async () => {
    await connection.pool.query('drop table if exists erasure_guard_probe');
    await connection.pool.query(
      'create table erasure_guard_probe (id uuid primary key, user_id uuid references users (id))',
    );
    try {
      const registry: readonly RegisteredTable[] = [
        ...REGISTRY,
        {
          table: 'erasure_guard_probe',
          userColumn: 'user_id',
          policy: 'cascade',
          seed: () => Promise.resolve(),
        },
      ];

      const violations = await guardViolations(connection.pool, registry);

      expect(violations).toEqual([
        'key erasure_guard_probe_user_id_fkey of erasure_guard_probe does not cascade on delete',
      ]);
    } finally {
      await connection.pool.query('drop table if exists erasure_guard_probe');
    }
  });

  it('ignores the two test-only fixture tables by exact name, and nothing else', async () => {
    // The real fixture tables, as the access-control tests create them: they reference users.
    await connection.pool.query(await readFile(FIXTURE_SCHEMA, 'utf8'));
    await connection.pool.query('drop table if exists erasure_guard_test_fixture_resources');
    await connection.pool.query(
      'create table erasure_guard_test_fixture_resources (id uuid primary key, owner_id uuid references users (id))',
    );
    try {
      const violations = await guardViolations(connection.pool);

      expect(violations).toEqual([
        expect.stringContaining('table erasure_guard_test_fixture_resources'),
        expect.stringContaining('key erasure_guard_test_fixture_resources_owner_id_fkey'),
      ]);
    } finally {
      await connection.pool.query('drop table if exists erasure_guard_test_fixture_resources');
    }
  });

  it('accepts the movements keys only as the named constraints of a table registered with erase-step', async () => {
    const keys = await foreignKeysFromUsers(connection.pool);
    const restricting = keys
      .filter((key) => key.child === 'movements' && key.deleteAction !== 'c')
      .map((key) => key.constraint)
      .sort();
    expect(restricting).toEqual([...MOVEMENTS_STEP_CONSTRAINTS].sort());

    expect(await guardViolations(connection.pool)).toEqual([]);
  });

  it('fails for the movements keys when the table is registered as cascade or names no constraint (error, sad path)', async () => {
    const withMovements = (entry: Partial<RegisteredTable>): RegisteredTable[] =>
      REGISTRY.map((candidate) =>
        candidate.table === 'movements' ? { ...candidate, ...entry } : candidate,
      );
    const expected = [
      'key movements_account_owner_fk of movements does not cascade on delete',
      'key movements_category_owner_kind_fk of movements does not cascade on delete',
      'key movements_destination_owner_fk of movements does not cascade on delete',
    ];

    const asCascade = await guardViolations(connection.pool, withMovements({ policy: 'cascade' }));
    const unnamed = await guardViolations(connection.pool, withMovements({ stepConstraints: [] }));
    const oneNamed = await guardViolations(
      connection.pool,
      withMovements({ stepConstraints: ['movements_account_owner_fk'] }),
    );

    expect(asCascade.sort()).toEqual(expected);
    expect(unnamed.sort()).toEqual(expected);
    expect(oneNamed).toEqual([expected[1], expected[2]]);
  });

  it('fails for another non-cascading key on the movements table, even though it is an erase-step table (error, sad path)', async () => {
    await connection.pool.query('alter table movements drop column if exists probe_user_id');
    await connection.pool.query(
      'alter table movements add column probe_user_id uuid references users (id)',
    );
    try {
      const violations = await guardViolations(connection.pool);

      expect(violations).toEqual([
        'key movements_probe_user_id_fkey of movements does not cascade on delete',
      ]);
    } finally {
      await connection.pool.query('alter table movements drop column if exists probe_user_id');
    }
  });

  it('fails for a non-cascading key on an unregistered table with both reasons (error, sad path)', async () => {
    await connection.pool.query('drop table if exists erasure_guard_probe');
    await connection.pool.query(
      'create table erasure_guard_probe (id uuid primary key, user_id uuid references users (id) on delete restrict)',
    );
    try {
      const violations = await guardViolations(connection.pool);

      expect(violations).toEqual([
        expect.stringContaining('table erasure_guard_probe'),
        'key erasure_guard_probe_user_id_fkey of erasure_guard_probe does not cascade on delete',
      ]);
    } finally {
      await connection.pool.query('drop table if exists erasure_guard_probe');
    }
  });

  it('records what PostgreSQL does with a bare delete from users when movements restrict (order-dependent fact)', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const userId = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
    const state: SeedContext['state'] = {};
    const email = 'ana@example.com';
    for (const entry of REGISTRY.filter((candidate) =>
      ['accounts', 'categories', 'movements'].includes(candidate.table),
    )) {
      await entry.seed({ connection, userId, email, harness, state });
    }
    const client = await connection.pool.connect();
    let outcome: 'deleted' | 'blocked' = 'deleted';
    try {
      await client.query('begin');
      try {
        await client.query('delete from users where id = $1', [userId]);
      } catch (error) {
        // The restricting keys may fire before the cascade removes the movements: that depends on
        // the order PostgreSQL fires the referential triggers, so both outcomes are legal.
        expect((error as { code?: string }).code).toBe('23503');
        outcome = 'blocked';
      } finally {
        await client.query('rollback');
      }
    } finally {
      client.release();
    }

    expect(['deleted', 'blocked']).toContain(outcome);
    const remaining = await connection.pool.query<{ n: string }>(
      'select count(*) as n from movements where owner_id = $1',
      [userId],
    );
    expect(Number(remaining.rows[0]?.n)).toBe(1);
  });
});

describe('deleting an account leaves no row of the user behind (NFR-01, AC-01)', () => {
  async function seeded(
    harness: IdentityHarness,
    email: string,
  ): Promise<{ userId: string; email: string; state: SeedContext['state'] }> {
    const userId = await seedUser(connection, { email, password: PASSWORD });
    const state: SeedContext['state'] = {};
    for (const entry of REGISTRY) {
      await entry.seed({ connection, userId, email, harness, state });
    }
    // By user id (a notice) and by address only (a payload without the user id).
    await connection.pool.query(
      "insert into email_outbox (id, kind, to_email, language, payload) values ($1, 'two_factor_enabled', $2, 'es', $3)",
      [randomUUID(), email, JSON.stringify({ userId })],
    );
    await connection.pool.query(
      "insert into email_outbox (id, kind, to_email, language, payload) values ($1, 'password_reset', $2, 'es', $3)",
      [randomUUID(), email, JSON.stringify({ userId: null })],
    );
    return { userId, email, state };
  }

  const outboxRows = async (userId: string, email: string): Promise<number> => {
    const result = await connection.pool.query<{ n: string }>(
      "select count(*) as n from email_outbox where payload->>'userId' = $1 or to_email = $2",
      [userId, email],
    );
    return Number(result.rows[0]?.n ?? 0);
  };

  it('has 0 rows for the user in every registered table and its outbox, while another user keeps all of theirs', async () => {
    const recurringStep = vi.fn(eraseUserRecurring);
    const movementsStep = vi.fn(eraseUserMovements);
    const cardsStep = vi.fn(eraseUserCreditCards);
    const groupsStep = vi.fn(eraseUserGroups);
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      beforeUserErased: [recurringStep, movementsStep, cardsStep, groupsStep],
    });
    const other = await seeded(harness, 'bea@example.com');
    // The deleting user signs in before 2FA is seeded, so the sign-in needs no second factor.
    const email = 'ana@example.com';
    const userId = await seedUser(connection, { email, password: PASSWORD });
    const cookies: SessionCookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    const state: SeedContext['state'] = {};
    for (const entry of REGISTRY) {
      await entry.seed({ connection, userId, email, harness, state });
    }
    await connection.pool.query(
      "insert into email_outbox (id, kind, to_email, language, payload) values ($1, 'two_factor_enabled', $2, 'es', $3)",
      [randomUUID(), email, JSON.stringify({ userId })],
    );
    for (const entry of REGISTRY) {
      expect(await rowsFor(entry, userId), `${entry.table} before`).toBeGreaterThan(0);
    }
    const userBefore = new Map<string, number>();
    const otherBefore = new Map<string, number>();
    for (const entry of REGISTRY) {
      userBefore.set(entry.table, await rowsFor(entry, userId));
      otherBefore.set(entry.table, await rowsFor(entry, other.userId));
    }

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: totpNow(state.secret ?? '', harness.clock) },
    });

    expect(response.status).toBe(204);
    expect(recurringStep).toHaveBeenCalledTimes(1);
    expect(recurringStep.mock.calls[0]?.[1]).toBe(userId);
    expect(movementsStep).toHaveBeenCalledTimes(1);
    expect(movementsStep.mock.calls[0]?.[1]).toBe(userId);
    expect(cardsStep).toHaveBeenCalledTimes(1);
    expect(cardsStep.mock.calls[0]?.[1]).toBe(userId);
    expect(groupsStep).toHaveBeenCalledTimes(1);
    expect(groupsStep.mock.calls[0]?.[1]).toBe(userId);
    for (const entry of REGISTRY) {
      // The group outlives its former member: its invitations and claim links stay, unlinked from the user.
      expect(await rowsFor(entry, userId), `${entry.table} after`).toBe(
        entry.survivesErasure ? userBefore.get(entry.table) : 0,
      );
      expect(await rowsFor(entry, other.userId), `${entry.table} of the other user`).toBe(
        otherBefore.get(entry.table),
      );
    }
    expect(await outboxRows(userId, email)).toBe(0);
    expect(await outboxRows(other.userId, other.email)).toBe(2);
    const remaining = await connection.pool.query<{ n: string }>(
      'select count(*) as n from users where id = $1',
      [userId],
    );
    expect(Number(remaining.rows[0]?.n)).toBe(0);
  });
});
