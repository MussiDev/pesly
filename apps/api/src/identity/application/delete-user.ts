import { Email } from '../domain/email';
import {
  InvalidCredentials,
  RateLimited,
  ReauthenticationRequired,
  Unauthenticated,
} from '../domain/errors';
import { SIGN_IN_ACCOUNT_POLICY, SIGN_IN_IP_POLICY } from './attempt-policies';
import { UNKNOWN_IP } from './client-ip';
import type { AttemptLimiter } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import type { DeletionGrantRepository } from './ports/deletion-grant-repository';
import type { PasswordHasher } from './ports/password-hasher';
import type { RecoveryCodeRepository } from './ports/recovery-code-repository';
import type { SecretBox } from './ports/secret-box';
import type { SessionRepository } from './ports/session-repository';
import type { TokenGenerator } from './ports/token-generator';
import type { TotpEngine } from './ports/totp';
import type { TwoFactorRepository } from './ports/two-factor-repository';
import type { ErasureGrant, UserDeletionRepository } from './ports/user-deletion-repository';
import type { User, UserRepository } from './ports/user-repository';
import { checkSecondFactor } from './require-second-factor';
import { refundAttempt, reserveAttempt, type ReservedAttempt } from './second-factor-limits';

/** The deletion grant lives 5 minutes (NFR-03). */
export const DELETION_GRANT_TTL_MS = 5 * 60 * 1000;

export interface DeleteUserDependencies {
  users: UserRepository;
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
  totp: TotpEngine;
  secretBox: SecretBox;
  /** Argon2id, for the password and for the hashes of recovery codes. */
  passwordHasher: PasswordHasher;
  attemptLimiter: AttemptLimiter;
  userDeletion: UserDeletionRepository;
  /** Reads the asking session's family, which a Google re-authentication grant is bound to. */
  sessions: SessionRepository;
  deletionGrants: DeletionGrantRepository;
  /** Hashes the grant cookie's token before any lookup. */
  tokenGenerator: TokenGenerator;
  clock: Clock;
  /** Told when a refund fails; the outcome is unchanged (fail safe). Must not log secrets. */
  reportRefundFailure: (error: unknown) => void;
  /** Told when the NFR-01 unit of a wrong code could not be recorded; the 400 is unchanged. */
  reportRecordFailure: (error: unknown) => void;
}

export interface DeleteUserInput {
  userId: string;
  /** The session that asked; a Google re-authentication grant is bound to its family. */
  sessionId: string;
  password: string | undefined;
  secondFactorCode: string | undefined;
  grantToken: string | undefined;
  ip: string | undefined;
}

/**
 * Deletes the account and everything that belongs to it (FR-01) after the user proves who they are
 * again: the password (checked with the sign-in limits, so a wrong one counts as a failed sign-in)
 * or, for an account without one, the grant of a recent Google re-authentication; and, with 2FA on,
 * a valid second-factor code (limited like disabling 2FA).
 */
export class DeleteUser {
  constructor(private readonly deps: DeleteUserDependencies) {}

  async execute({
    userId,
    sessionId,
    password,
    secondFactorCode,
    grantToken,
    ip,
  }: DeleteUserInput): Promise<void> {
    // The user is read before its 2FA settings: a 2FA enable that commits in between bumped the
    // credentials version, so `erase` below refuses instead of the second factor being skipped.
    const user = await this.deps.users.findById(userId);
    if (!user) throw new Unauthenticated();
    const settings = await this.deps.twoFactor.findByUserId(userId);

    // A user with a password never uses a grant: Google re-authentication is not accepted for it.
    let grant: ErasureGrant | undefined;
    if (user.passwordHash === null) {
      grant = await this.checkGrant(user, sessionId, grantToken);
    } else {
      await this.checkPassword(user.email, user.passwordHash, password, ip ?? UNKNOWN_IP);
    }
    // A wrong code leaves the grant alone: it is only consumed by the deletion itself.
    if (settings?.enabledAt) await checkSecondFactor(this.deps, user, settings, secondFactorCode);

    // A credentials version that moved on since the read (a password reset, a 2FA change) or an
    // account that is already gone is refused here, atomically with the deletion.
    const result = await this.deps.userDeletion.erase({
      userId,
      credentialsVersion: user.credentialsVersion,
      ...(grant ? { grant } : {}),
    });
    if (result === 'grant_invalid') throw new ReauthenticationRequired();
    if (result !== 'erased') throw new Unauthenticated();
  }

  /**
   * A live grant for this user, this session family and these credentials; read here without
   * consuming it, so a failed second factor does not spend it. Nothing is reserved: a missing or
   * unknown token is not a guess at a secret anyone could brute-force (256 random bits).
   */
  private async checkGrant(
    user: User,
    sessionId: string,
    grantToken: string | undefined,
  ): Promise<ErasureGrant> {
    if (grantToken === undefined) throw new ReauthenticationRequired();
    const session = await this.deps.sessions.findById(sessionId);
    if (!session) throw new Unauthenticated();

    const tokenHash = this.deps.tokenGenerator.hash(grantToken);
    const now = this.deps.clock.now();
    const live = await this.deps.deletionGrants.findLive(
      tokenHash,
      user.id,
      session.familyId,
      user.credentialsVersion,
      now,
    );
    if (!live) throw new ReauthenticationRequired();
    return { tokenHash, sessionFamilyId: session.familyId, now };
  }

  /** Reserve-then-refund with the sign-in policies: only failed guesses keep their units. */
  private async checkPassword(
    email: string,
    passwordHash: string,
    password: string | undefined,
    ip: string,
  ): Promise<void> {
    // Not a guess, so nothing is reserved.
    if (password === undefined) throw new InvalidCredentials();

    const limiter = this.deps.attemptLimiter;
    const [account, address] = await Promise.all([
      reserveAttempt(limiter, [SIGN_IN_ACCOUNT_POLICY], Email.parse(email).value),
      reserveAttempt(limiter, [SIGN_IN_IP_POLICY], ip),
    ]);
    const attempt: ReservedAttempt = {
      allowed: account.allowed && address.allowed,
      reservations: [...account.reservations, ...address.reservations],
    };
    if (!attempt.allowed) {
      // Refused before any Argon2id work: not a guess, so it does not count either.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw new RateLimited();
    }

    let matches: boolean;
    try {
      matches = await this.deps.passwordHasher.verify(passwordHash, password);
    } catch (error) {
      // A fault is not a failed guess either.
      await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
      throw error;
    }
    if (!matches) throw new InvalidCredentials();
    await refundAttempt(limiter, attempt, this.deps.reportRefundFailure);
  }
}
