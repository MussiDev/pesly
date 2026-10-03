import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrizzleDeletionGrantRepository } from '../../src/identity/infrastructure/db/drizzle-deletion-grant-repository';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { eraseUserMovements } from '../../src/movements';
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
  /** Creates one real row for the user. */
  seed: (context: SeedContext) => Promise<void>;
}

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
    `select count(*) as n from ${entry.table} where ${entry.userColumn} = $1`,
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
    const movementsStep = vi.fn(eraseUserMovements);
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      beforeUserErased: [movementsStep],
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
    const otherBefore = new Map<string, number>();
    for (const entry of REGISTRY) {
      otherBefore.set(entry.table, await rowsFor(entry, other.userId));
    }

    const response = await deleteAccount(harness.app, cookies, {
      body: { password: PASSWORD, secondFactorCode: totpNow(state.secret ?? '', harness.clock) },
    });

    expect(response.status).toBe(204);
    expect(movementsStep).toHaveBeenCalledTimes(1);
    expect(movementsStep.mock.calls[0]?.[1]).toBe(userId);
    for (const entry of REGISTRY) {
      expect(await rowsFor(entry, userId), `${entry.table} after`).toBe(0);
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
