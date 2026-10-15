import { describe, expect, it } from 'vitest';
import {
  SIGN_IN_ACCOUNT_POLICY,
  TWO_FACTOR_DISABLE_USER_15M_POLICY,
  TWO_FACTOR_DISABLE_USER_24H_POLICY,
} from '../../src/identity/application/attempt-policies';
import type {
  AttemptLimiter,
  AttemptPolicy,
} from '../../src/identity/application/ports/attempt-limiter';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type { RecoveryCodeRepository } from '../../src/identity/application/ports/recovery-code-repository';
import type { SecretBox } from '../../src/identity/application/ports/secret-box';
import type { TotpEngine } from '../../src/identity/application/ports/totp';
import type { TwoFactorRepository } from '../../src/identity/application/ports/two-factor-repository';
import type { User, UserRepository } from '../../src/identity/application/ports/user-repository';
import { RequireSecondFactor } from '../../src/identity/application/require-second-factor';
import { RateLimited, TotpInvalid, Unauthenticated } from '../../src/identity/domain/errors';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const GOOD_CODE = '123456';
const WRONG_CODE = '654321';

const user: User = {
  id: USER_ID,
  email: 'ana@example.com',
  passwordHash: 'hash',
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  defaultRateType: 'oficial',
  displayCurrency: 'ARS',
  timeZone: 'America/Cordoba',
  language: 'es',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  credentialsVersion: 1,
  passwordChangedAt: null,
};

class InMemoryLimiter implements AttemptLimiter {
  readonly counts = new Map<string, number>();
  isLimitReached(): Promise<boolean> {
    return Promise.resolve(false);
  }
  record(policy: AttemptPolicy, key: string) {
    const id = `${policy.kind}|${key}`;
    const count = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, count);
    return Promise.resolve({ count, allowed: count <= policy.limit, windowStart: new Date(0) });
  }
  release(policy: AttemptPolicy, key: string): Promise<void> {
    const id = `${policy.kind}|${key}`;
    this.counts.set(id, Math.max(0, (this.counts.get(id) ?? 0) - 1));
    return Promise.resolve();
  }
  countOf(policy: AttemptPolicy, key: string): number {
    return this.counts.get(`${policy.kind}|${key}`) ?? 0;
  }
  total(): number {
    return [...this.counts.values()].reduce((sum, count) => sum + count, 0);
  }
}

function build({
  enabled = true,
  currentUser = user,
}: { enabled?: boolean; currentUser?: typeof user | null } = {}) {
  const limiter = new InMemoryLimiter();
  const verified: string[] = [];
  const users = { findById: () => Promise.resolve(currentUser) } as unknown as UserRepository;
  const twoFactor = {
    findByUserId: () =>
      Promise.resolve(
        enabled
          ? {
              userId: USER_ID,
              secretSealed: 'sealed',
              enabledAt: new Date('2026-01-01T00:00:00Z'),
              lastUsedStep: 0,
              createdAt: new Date('2026-01-01T00:00:00Z'),
            }
          : null,
      ),
    advanceLastUsedStep: () => Promise.resolve(true),
  } as unknown as TwoFactorRepository;
  const totp = {
    verify: (_secret: string, code: string) => {
      verified.push(code);
      return code === GOOD_CODE ? 1 : null;
    },
  } as unknown as TotpEngine;
  const secretBox: SecretBox = { seal: (value) => value, open: () => 'secret' };
  const passwordHasher: PasswordHasher = {
    hash: (password) => Promise.resolve(`hash:${password}`),
    verify: (hash, password) => Promise.resolve(hash === `hash:${password}`),
  };
  const gate = new RequireSecondFactor({
    users,
    twoFactor,
    recoveryCodes: {} as RecoveryCodeRepository,
    totp,
    secretBox,
    passwordHasher,
    attemptLimiter: limiter,
    clock: { now: () => new Date('2026-06-01T00:00:00Z') },
    reportRefundFailure: () => undefined,
    reportRecordFailure: () => undefined,
  });
  return { gate, limiter, verified };
}

describe('RequireSecondFactor', () => {
  it('returns at once with 2FA off, touching neither the limiter nor the code (AC-19)', async () => {
    const { gate, limiter, verified } = build({ enabled: false });
    await expect(gate.require(USER_ID, undefined)).resolves.toBeUndefined();
    await expect(gate.require(USER_ID, WRONG_CODE)).resolves.toBeUndefined();
    expect(limiter.total()).toBe(0);
    expect(verified).toEqual([]);
  });

  it('accepts a valid code and gives the reserved units back (AC-19)', async () => {
    const { gate, limiter } = build();
    await expect(gate.require(USER_ID, GOOD_CODE)).resolves.toBeUndefined();
    expect(limiter.total()).toBe(0);
  });

  it('answers TotpInvalid for a missing code without reserving anything (AC-20) (sad path)', async () => {
    const { gate, limiter, verified } = build();
    await expect(gate.require(USER_ID, undefined)).rejects.toBeInstanceOf(TotpInvalid);
    expect(limiter.total()).toBe(0);
    expect(verified).toEqual([]);
  });

  it('answers TotpInvalid for a wrong code, keeps its units and counts it on the sign-in limit (AC-20, R-08) (sad path)', async () => {
    const { gate, limiter } = build();
    await expect(gate.require(USER_ID, WRONG_CODE)).rejects.toBeInstanceOf(TotpInvalid);
    expect(limiter.countOf(TWO_FACTOR_DISABLE_USER_15M_POLICY, USER_ID)).toBe(1);
    expect(limiter.countOf(TWO_FACTOR_DISABLE_USER_24H_POLICY, USER_ID)).toBe(1);
    expect(limiter.countOf(SIGN_IN_ACCOUNT_POLICY, user.email)).toBe(1);
  });

  it('answers TotpInvalid for a malformed code (AC-20) (sad path)', async () => {
    const { gate } = build();
    await expect(gate.require(USER_ID, 'not-a-code')).rejects.toBeInstanceOf(TotpInvalid);
  });

  it('answers RateLimited without checking the code once the limit is exhausted (AC-20, R-08) (sad path)', async () => {
    const { gate, limiter, verified } = build();
    for (let i = 0; i < TWO_FACTOR_DISABLE_USER_15M_POLICY.limit; i += 1) {
      await expect(gate.require(USER_ID, WRONG_CODE)).rejects.toBeInstanceOf(TotpInvalid);
    }
    verified.length = 0;
    await expect(gate.require(USER_ID, GOOD_CODE)).rejects.toBeInstanceOf(RateLimited);
    expect(verified).toEqual([]);
    expect(limiter.countOf(TWO_FACTOR_DISABLE_USER_15M_POLICY, USER_ID)).toBe(
      TWO_FACTOR_DISABLE_USER_15M_POLICY.limit,
    );
  });

  it('answers Unauthenticated for a user that no longer exists (sad path)', async () => {
    const { gate } = build({ currentUser: null });
    await expect(gate.require(USER_ID, GOOD_CODE)).rejects.toBeInstanceOf(Unauthenticated);
  });
});
