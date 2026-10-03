import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IdentityDb, UserErasureStep } from '../../src/identity';
import type { DeletionGrant } from '../../src/identity/application/ports/deletion-grant-repository';
import { Email } from '../../src/identity/domain/email';
import { Unauthenticated } from '../../src/identity/domain/errors';
import { DrizzleDeletionGrantRepository } from '../../src/identity/infrastructure/db/drizzle-deletion-grant-repository';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let users: DrizzleUserRepository;
let grants: DrizzleDeletionGrantRepository;
let oauthStates: DrizzleOAuthStateRepository;
let sessions: DrizzleSessionRepository;
let deletion: DrizzleUserDeletionRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  users = new DrizzleUserRepository(connection.db);
  grants = new DrizzleDeletionGrantRepository(connection.db);
  oauthStates = new DrizzleOAuthStateRepository(connection.db);
  sessions = new DrizzleSessionRepository(connection.db);
  deletion = new DrizzleUserDeletionRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const NOW = new Date('2026-10-02T12:00:00.000Z');
const FIVE_MINUTES = 5 * 60 * 1000;
const FAMILY = 'f0000000-0000-4000-8000-000000000001';
const IDLE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_TIMEOUT_TEST_MS = 30_000;

async function createUser(email: string): Promise<string> {
  const created = await users.create({
    email: Email.parse(email),
    passwordHash: null,
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Cordoba',
    language: 'es',
  });
  return created.id;
}

function grantFor(userId: string, overrides: Partial<DeletionGrant> = {}): DeletionGrant {
  return {
    tokenHash: `grant-${userId}`,
    userId,
    sessionFamilyId: FAMILY,
    credentialsVersion: 0,
    expiresAt: new Date(NOW.getTime() + FIVE_MINUTES),
    ...overrides,
  };
}

async function count(statement: string, params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
}

/** One row in every table that hangs from the user, plus outbox rows by user id and by address. */
async function seedDependents(userId: string, email: string): Promise<void> {
  const q = (statement: string, params: unknown[]) => connection.pool.query(statement, params);
  await sessions.create({
    userId,
    familyId: FAMILY,
    refreshTokenHash: `rt-${userId}`,
    credentialsVersion: 0,
    lastUsedAt: NOW,
  });
  await q(
    "insert into one_time_tokens (id, user_id, purpose, token_hash, expires_at) values ($1, $2, 'password_reset', $3, $4)",
    [randomUUID(), userId, `ott-${userId}`, NOW],
  );
  await q("insert into user_two_factor (user_id, secret_sealed) values ($1, 'sealed')", [userId]);
  await q('insert into recovery_codes (user_id, code_hash) values ($1, $2)', [userId, 'hash']);
  await q(
    "insert into sign_in_challenges (token_hash, user_id, credentials_version, via, language, expires_at) values ($1, $2, 0, 'password', 'es', $3)",
    [`sic-${userId}`, userId, NOW],
  );
  await q(
    "insert into user_identities (user_id, provider, subject, email_authoritative) values ($1, 'google', $2, true)",
    [userId, `sub-${userId}`],
  );
  await q(
    "insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ($1, 'Caja', 'cash', 'ARS', 0, true)",
    [userId],
  );
  const portfolio = await q(
    "insert into portfolios (owner_id, name) values ($1, 'Balanz') returning id",
    [userId],
  );
  await q(
    "insert into holdings (portfolio_id, owner_id, ticker, instrument_name, instrument_type, quantity, valuation_currency) values ($1, $2, 'AAPL', 'Apple', 'cedear', 1000000000, 'ARS')",
    [(portfolio.rows[0] as { id: string }).id, userId],
  );
  await q(
    "insert into portfolio_value_snapshots (portfolio_id, owner_id, snapshot_date, currency, total_value, taken_at) values ($1, $2, '2026-10-01', 'ARS', 1500000, $3)",
    [(portfolio.rows[0] as { id: string }).id, userId, NOW],
  );
  await oauthStates.create({
    stateHash: `state-${userId}`,
    bindingHash: 'binding',
    nonceHash: 'nonce',
    codeVerifier: 'verifier',
    timeZone: 'UTC',
    language: 'es',
    purpose: 'delete_account',
    userId,
    sessionFamilyId: FAMILY,
    expiresAt: new Date(NOW.getTime() + FIVE_MINUTES),
  });
  // By user id (a notice) and by address only (an outbox row whose payload carries no user id).
  await q(
    "insert into email_outbox (id, kind, to_email, language, payload) values ($1, 'two_factor_enabled', $2, 'es', $3)",
    [randomUUID(), email, JSON.stringify({ userId })],
  );
  await q(
    "insert into email_outbox (id, kind, to_email, language, payload) values ($1, 'password_reset', $2, 'es', $3)",
    [randomUUID(), email, JSON.stringify({ userId: null })],
  );
}

const USER_TABLES = [
  'sessions',
  'one_time_tokens',
  'user_two_factor',
  'recovery_codes',
  'sign_in_challenges',
  'user_identities',
  'oauth_states',
] as const;

async function rowsOf(userId: string): Promise<number> {
  let total = await count('select count(*) as n from users where id = $1', [userId]);
  total += await count('select count(*) as n from accounts where owner_id = $1', [userId]);
  total += await count('select count(*) as n from portfolios where owner_id = $1', [userId]);
  total += await count('select count(*) as n from holdings where owner_id = $1', [userId]);
  total += await count('select count(*) as n from portfolio_value_snapshots where owner_id = $1', [
    userId,
  ]);
  total += await count('select count(*) as n from deletion_grants where user_id = $1', [userId]);
  for (const table of USER_TABLES) {
    total += await count(`select count(*) as n from ${table} where user_id = $1`, [userId]);
  }
  return total;
}

async function outboxRowsOf(userId: string, email: string): Promise<number> {
  return count(
    "select count(*) as n from email_outbox where payload->>'userId' = $1 or to_email = $2",
    [userId, email],
  );
}

describe('DrizzleDeletionGrantRepository', () => {
  it('keeps one live grant per user and finds it without consuming it', async () => {
    const userId = await createUser('ana@example.com');
    const otherId = await createUser('bob@example.com');
    await grants.replace(grantFor(userId, { tokenHash: 'first' }));
    await grants.replace(grantFor(otherId));

    await grants.replace(grantFor(userId, { tokenHash: 'second' }));

    expect(
      await count('select count(*) as n from deletion_grants where user_id = $1', [userId]),
    ).toBe(1);
    expect(await grants.findLive('first', userId, FAMILY, 0, NOW)).toBeNull();
    const found = await grants.findLive('second', userId, FAMILY, 0, NOW);
    expect(found).toEqual(grantFor(userId, { tokenHash: 'second' }));
    // Reading twice proves the first read did not consume it.
    expect(await grants.findLive('second', userId, FAMILY, 0, NOW)).not.toBeNull();
    expect(await grants.findLive(`grant-${otherId}`, otherId, FAMILY, 0, NOW)).not.toBeNull();
  });

  it('keeps exactly one grant when many replaces for one user run concurrently', async () => {
    const userId = await createUser('ana@example.com');
    const ROUNDS = 5;
    const PARALLEL = 20;

    for (let round = 0; round < ROUNDS; round += 1) {
      const tokens = Array.from({ length: PARALLEL }, (_, i) => `r${round}-t${i}`);
      await Promise.all(tokens.map((tokenHash) => grants.replace(grantFor(userId, { tokenHash }))));

      const rows = await connection.pool.query<{ token_hash: string }>(
        'select token_hash from deletion_grants where user_id = $1',
        [userId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(tokens).toContain(rows.rows[0]?.token_hash);
    }
  });

  it('does not find an expired grant, one for another user or family, or an older credentials version (sad path)', async () => {
    const userId = await createUser('ana@example.com');
    const otherId = await createUser('bob@example.com');
    await grants.replace(grantFor(userId));
    const token = `grant-${userId}`;

    expect(
      await grants.findLive(token, userId, FAMILY, 0, new Date(NOW.getTime() + FIVE_MINUTES)),
    ).toBeNull();
    expect(await grants.findLive(token, otherId, FAMILY, 0, NOW)).toBeNull();
    expect(await grants.findLive(token, userId, randomUUID(), 0, NOW)).toBeNull();
    expect(await grants.findLive(token, userId, FAMILY, 1, NOW)).toBeNull();
    expect(await grants.findLive('unknown', userId, FAMILY, 0, NOW)).toBeNull();
    expect(await grants.findLive(token, userId, FAMILY, 0, NOW)).not.toBeNull();
  });

  it('purgeExpired removes only expired grants', async () => {
    const ana = await createUser('ana@example.com');
    const bob = await createUser('bob@example.com');
    const carla = await createUser('carla@example.com');
    await grants.replace(grantFor(ana, { expiresAt: new Date(NOW.getTime() - 1) }));
    await grants.replace(grantFor(bob, { expiresAt: NOW }));
    await grants.replace(grantFor(carla, { expiresAt: new Date(NOW.getTime() + 1) }));

    expect(await grants.purgeExpired(NOW)).toBe(2);

    const left = await connection.pool.query<{ user_id: string }>(
      'select user_id from deletion_grants',
    );
    expect(left.rows.map((row) => row.user_id)).toEqual([carla]);
  });
});

describe('DrizzleUserDeletionRepository.erase', () => {
  it('consumes a valid grant exactly once and deletes the user, its dependents and its outbox rows, leaving another user intact', async () => {
    const ana = await createUser('ana@example.com');
    const bob = await createUser('bob@example.com');
    await seedDependents(ana, 'ana@example.com');
    await seedDependents(bob, 'bob@example.com');
    await grants.replace(grantFor(ana));
    await grants.replace(grantFor(bob));
    const bobRows = await rowsOf(bob);
    const grant = { tokenHash: `grant-${ana}`, sessionFamilyId: FAMILY, now: NOW };

    expect(await rowsOf(ana)).toBe(13);
    expect(await outboxRowsOf(ana, 'ana@example.com')).toBe(2);

    expect(await deletion.erase({ userId: ana, credentialsVersion: 0, grant })).toBe('erased');

    expect(await rowsOf(ana)).toBe(0);
    expect(await outboxRowsOf(ana, 'ana@example.com')).toBe(0);
    expect(await rowsOf(bob)).toBe(bobRows);
    expect(await outboxRowsOf(bob, 'bob@example.com')).toBe(2);
    // The user is gone, so the same grant cannot be used again.
    expect(await deletion.erase({ userId: ana, credentialsVersion: 0, grant })).toBe('stale');
  });

  it('erases without a grant (the password path) and deletes the outbox rows too', async () => {
    const ana = await createUser('ana@example.com');
    await seedDependents(ana, 'ana@example.com');

    expect(await deletion.erase({ userId: ana, credentialsVersion: 0 })).toBe('erased');

    expect(await rowsOf(ana)).toBe(0);
    expect(await outboxRowsOf(ana, 'ana@example.com')).toBe(0);
  });

  const OTHER_FAMILY = randomUUID();
  const badGrants: {
    name: string;
    storedFor: 'ana' | 'bob';
    stored?: Partial<DeletionGrant>;
    presentedHash?: string;
    presentedFamily?: string;
    credentialsVersion?: number;
  }[] = [
    { name: 'an expired grant', storedFor: 'ana', stored: { expiresAt: NOW } },
    { name: 'a grant of another user', storedFor: 'bob' },
    { name: 'a grant of another session family', storedFor: 'ana', presentedFamily: OTHER_FAMILY },
    { name: 'a grant of an older credentials version', storedFor: 'ana', credentialsVersion: 1 },
    { name: 'an unknown hash', storedFor: 'ana', presentedHash: 'unknown' },
  ];

  it.each(badGrants)(
    'fails with grant_invalid for $name and deletes nothing (sad path)',
    async ({ storedFor, stored, presentedHash, presentedFamily, credentialsVersion = 0 }) => {
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com');
      if (credentialsVersion > 0) await users.bumpCredentialsVersion(ana);
      await seedDependents(ana, 'ana@example.com');
      await grants.replace(
        grantFor(storedFor === 'ana' ? ana : bob, { tokenHash: 'token', ...stored }),
      );
      const before = {
        ana: await rowsOf(ana),
        outbox: await outboxRowsOf(ana, 'ana@example.com'),
        grants: await count('select count(*) as n from deletion_grants'),
      };

      const result = await deletion.erase({
        userId: ana,
        credentialsVersion,
        grant: {
          tokenHash: presentedHash ?? 'token',
          sessionFamilyId: presentedFamily ?? FAMILY,
          now: NOW,
        },
      });

      expect(result).toBe('grant_invalid');
      expect(await rowsOf(ana)).toBe(before.ana);
      expect(await outboxRowsOf(ana, 'ana@example.com')).toBe(before.outbox);
      expect(await count('select count(*) as n from deletion_grants')).toBe(before.grants);
    },
  );

  it('resolves stale for a stale credentials version or an unknown id and keeps every row, the grant included (sad path)', async () => {
    const ana = await createUser('ana@example.com');
    await seedDependents(ana, 'ana@example.com');
    await grants.replace(grantFor(ana));
    const grant = { tokenHash: `grant-${ana}`, sessionFamilyId: FAMILY, now: NOW };
    const before = await rowsOf(ana);

    expect(await deletion.erase({ userId: ana, credentialsVersion: 1, grant })).toBe('stale');
    expect(await deletion.erase({ userId: ana, credentialsVersion: 1 })).toBe('stale');
    expect(await deletion.erase({ userId: randomUUID(), credentialsVersion: 0, grant })).toBe(
      'stale',
    );

    expect(await rowsOf(ana)).toBe(before);
    expect(await outboxRowsOf(ana, 'ana@example.com')).toBe(2);
  });

  it(
    'fails with an error and deletes nothing when the lock on the user row outlasts the lock timeout (error, sad path)',
    async () => {
      const ana = await createUser('ana@example.com');
      await seedDependents(ana, 'ana@example.com');
      await grants.replace(grantFor(ana));
      const before = await rowsOf(ana);
      const holder = new pg.Client({ connectionString: testDatabaseUrl });
      await holder.connect();
      await holder.query('begin');
      await holder.query('select id from users where id = $1 for update', [ana]);
      try {
        await expect(
          deletion.erase({
            userId: ana,
            credentialsVersion: 0,
            grant: { tokenHash: `grant-${ana}`, sessionFamilyId: FAMILY, now: NOW },
          }),
        ).rejects.toMatchObject({ cause: { code: '55P03' } });
      } finally {
        await holder.query('rollback');
        await holder.end();
      }

      expect(await rowsOf(ana)).toBe(before);
      expect(await outboxRowsOf(ana, 'ana@example.com')).toBe(2);
    },
    LOCK_TIMEOUT_TEST_MS,
  );

  it('skips an outbox row that another transaction holds instead of waiting for it', async () => {
    const ana = await createUser('ana@example.com');
    await seedDependents(ana, 'ana@example.com');
    const holder = new pg.Client({ connectionString: testDatabaseUrl });
    await holder.connect();
    await holder.query('begin');
    const held = await holder.query<{ id: string }>(
      "select id from email_outbox where kind = 'password_reset' for update",
    );
    try {
      expect(await deletion.erase({ userId: ana, credentialsVersion: 0 })).toBe('erased');
    } finally {
      await holder.query('rollback');
      await holder.end();
    }

    const left = await connection.pool.query<{ id: string }>('select id from email_outbox');
    expect(left.rows).toEqual(held.rows);
    expect(await rowsOf(ana)).toBe(0);
  });
});

describe('DrizzleUserDeletionRepository.erase with ordered steps', () => {
  it('runs the steps in order with the transaction, after the outbox delete and the grant check, with the user row locked and still present', async () => {
    const ana = await createUser('ana@example.com');
    await seedDependents(ana, 'ana@example.com');
    await grants.replace(grantFor(ana));
    const seen: string[] = [];
    const observe = async (name: string, tx: IdentityDb): Promise<void> => {
      const outbox = await tx.execute(
        sql`select count(*) as n from email_outbox where to_email = 'ana@example.com'`,
      );
      const grantRows = await tx.execute(
        sql`select count(*) as n from deletion_grants where user_id = ${ana}`,
      );
      const userRows = await tx.execute(sql`select count(*) as n from users where id = ${ana}`);
      // Another connection cannot take the user row while the transaction holds it.
      const probe = await connection.pool.connect();
      let locked = false;
      try {
        await probe.query('begin');
        await probe.query('select id from users where id = $1 for update nowait', [ana]);
      } catch (error) {
        locked = (error as { code?: string }).code === '55P03';
      } finally {
        await probe.query('rollback');
        probe.release();
      }
      seen.push(
        `${name}: outbox=${String(outbox.rows[0]?.n)} grant=${String(grantRows.rows[0]?.n)} user=${String(userRows.rows[0]?.n)} locked=${String(locked)}`,
      );
    };
    const steps: UserErasureStep[] = [(tx) => observe('first', tx), (tx) => observe('second', tx)];

    const result = await new DrizzleUserDeletionRepository(connection.db, steps).erase({
      userId: ana,
      credentialsVersion: 0,
      grant: { tokenHash: `grant-${ana}`, sessionFamilyId: FAMILY, now: NOW },
    });

    expect(result).toBe('erased');
    expect(seen).toEqual([
      'first: outbox=0 grant=0 user=1 locked=true',
      'second: outbox=0 grant=0 user=1 locked=true',
    ]);
    expect(await rowsOf(ana)).toBe(0);
  });

  it('rolls back the whole deletion when a step throws: the user, dependents, outbox rows and grant stay (error path)', async () => {
    const ana = await createUser('ana@example.com');
    await seedDependents(ana, 'ana@example.com');
    await grants.replace(grantFor(ana));
    const before = await rowsOf(ana);
    const boom = new Error('step failed');
    const later = vi.fn(() => Promise.resolve());
    const steps: UserErasureStep[] = [
      async (tx) => {
        await tx.execute(sql`delete from accounts where owner_id = ${ana}`);
      },
      () => Promise.reject(boom),
      later,
    ];

    await expect(
      new DrizzleUserDeletionRepository(connection.db, steps).erase({
        userId: ana,
        credentialsVersion: 0,
        grant: { tokenHash: `grant-${ana}`, sessionFamilyId: FAMILY, now: NOW },
      }),
    ).rejects.toBe(boom);

    expect(later).not.toHaveBeenCalled();
    expect(await rowsOf(ana)).toBe(before);
    expect(await outboxRowsOf(ana, 'ana@example.com')).toBe(2);
    expect(await count('select count(*) as n from deletion_grants where user_id = $1', [ana])).toBe(
      1,
    );
  });

  it('aborts before any step runs for a stale credentials version or an invalid grant (error path)', async () => {
    const ana = await createUser('ana@example.com');
    await seedDependents(ana, 'ana@example.com');
    await grants.replace(grantFor(ana));
    const step = vi.fn(() => Promise.resolve());
    const repository = new DrizzleUserDeletionRepository(connection.db, [step]);

    const stale = await repository.erase({ userId: ana, credentialsVersion: 1 });
    const invalid = await repository.erase({
      userId: ana,
      credentialsVersion: 0,
      grant: { tokenHash: 'unknown', sessionFamilyId: FAMILY, now: NOW },
    });

    expect(stale).toBe('stale');
    expect(invalid).toBe('grant_invalid');
    expect(step).not.toHaveBeenCalled();
  });
});

describe('DrizzleSessionRepository', () => {
  it('refuses a session for a user deleted meanwhile with Unauthenticated instead of a database error (error, sad path)', async () => {
    const ana = await createUser('ana@example.com');
    await deletion.erase({ userId: ana, credentialsVersion: 0 });

    await expect(
      sessions.create({
        userId: ana,
        refreshTokenHash: 'late',
        credentialsVersion: 0,
        lastUsedAt: NOW,
      }),
    ).rejects.toBeInstanceOf(Unauthenticated);
  });
});

describe('DrizzleOAuthStateRepository purposes', () => {
  const base = {
    bindingHash: 'binding',
    nonceHash: 'nonce',
    codeVerifier: 'verifier',
    timeZone: 'UTC',
    language: 'es',
    expiresAt: new Date(NOW.getTime() + FIVE_MINUTES),
  } as const;

  it('rejects a delete_account state without a user or a family, and a sign_in state with a user (sad path)', async () => {
    const ana = await createUser('ana@example.com');

    await expect(
      oauthStates.create({
        ...base,
        stateHash: 's1',
        purpose: 'delete_account',
        userId: null,
        sessionFamilyId: FAMILY,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      oauthStates.create({
        ...base,
        stateHash: 's2',
        purpose: 'delete_account',
        userId: ana,
        sessionFamilyId: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      oauthStates.create({
        ...base,
        stateHash: 's3',
        purpose: 'sign_in',
        userId: ana,
        sessionFamilyId: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      oauthStates.create({
        ...base,
        stateHash: 's4',
        purpose: 'sign_in',
        userId: null,
        sessionFamilyId: FAMILY,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    expect(await count('select count(*) as n from oauth_states')).toBe(0);
  });
});

describe('DrizzleSessionRepository.isFamilyLive', () => {
  async function family(userId: string): Promise<{ familyId: string; first: string }> {
    const familyId = randomUUID();
    const first = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: `a-${familyId}`,
      credentialsVersion: 0,
      lastUsedAt: NOW,
    });
    return { familyId, first: first.id };
  }

  it('is true for an unrevoked session within the idle limit, also after a refresh rotation', async () => {
    const ana = await createUser('ana@example.com');
    const { familyId, first } = await family(ana);
    expect(await sessions.isFamilyLive(familyId, NOW)).toBe(true);

    const next = await sessions.create({
      userId: ana,
      familyId,
      refreshTokenHash: `b-${familyId}`,
      credentialsVersion: 0,
      lastUsedAt: NOW,
    });
    await sessions.markReplaced(first, next.id, NOW);

    expect(await sessions.isFamilyLive(familyId, NOW)).toBe(true);
  });

  it('is false when every session of the family is revoked, idle for too long, or the family is unknown', async () => {
    const ana = await createUser('ana@example.com');
    const revoked = await family(ana);
    await sessions.revokeFamily(revoked.familyId, NOW);
    const idle = await family(ana);

    expect(await sessions.isFamilyLive(revoked.familyId, NOW)).toBe(false);
    expect(
      await sessions.isFamilyLive(idle.familyId, new Date(NOW.getTime() + IDLE_LIMIT_MS - 1)),
    ).toBe(true);
    expect(
      await sessions.isFamilyLive(idle.familyId, new Date(NOW.getTime() + IDLE_LIMIT_MS)),
    ).toBe(false);
    expect(await sessions.isFamilyLive(randomUUID(), NOW)).toBe(false);
  });
});
