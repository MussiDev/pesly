import { RateLimited, TotpInvalid, Unauthenticated } from '../domain/errors';
import { TWO_FACTOR_DISABLE_POLICIES } from './attempt-policies';
import type { AttemptLimiter } from './ports/attempt-limiter';
import type { Clock } from './ports/clock';
import type { PasswordHasher } from './ports/password-hasher';
import type { RecoveryCodeRepository } from './ports/recovery-code-repository';
import type { SecretBox } from './ports/secret-box';
import type { TotpEngine } from './ports/totp';
import type { TwoFactorRepository, TwoFactorSettings } from './ports/two-factor-repository';
import type { User, UserRepository } from './ports/user-repository';
import {
  checkSecondFactorCode,
  parseSecondFactorCode,
  recordSignInFailure,
  refundAttempt,
  reserveAttempt,
} from './second-factor-limits';

export interface SecondFactorGateDependencies {
  users: UserRepository;
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
  totp: TotpEngine;
  secretBox: SecretBox;
  /** Argon2id, for the hashes of recovery codes. */
  passwordHasher: PasswordHasher;
  attemptLimiter: AttemptLimiter;
  clock: Clock;
  /** Told when a refund fails; the outcome is unchanged (fail safe). Must not log secrets. */
  reportRefundFailure: (error: unknown) => void;
  /** Told when the NFR-01 unit of a wrong code could not be recorded; the answer is unchanged. */
  reportRecordFailure: (error: unknown) => void;
}

/**
 * A TOTP or recovery code, limited with the policies of disabling 2FA. The code is spent here,
 * before the caller's transaction (A-12): a request that then loses a race has burned one code.
 * Shared by account deletion and by every other action that asks the second factor again.
 */
export async function checkSecondFactor(
  deps: SecondFactorGateDependencies,
  user: User,
  settings: TwoFactorSettings,
  code: string | undefined,
): Promise<void> {
  // Not a guess, so nothing is reserved.
  if (code === undefined) throw new TotpInvalid();

  const limiter = deps.attemptLimiter;
  const attempt = await reserveAttempt(limiter, TWO_FACTOR_DISABLE_POLICIES, user.id);
  if (!attempt.allowed) {
    // Refused without checking the code: not a guess, so it does not count either.
    await refundAttempt(limiter, attempt, deps.reportRefundFailure);
    throw new RateLimited();
  }

  const parsed = parseSecondFactorCode(code);
  let valid: boolean;
  try {
    valid =
      parsed !== null &&
      (await checkSecondFactorCode(deps, deps, settings, parsed, deps.clock.now()));
  } catch (error) {
    // No encryption key or a fault: the units go back and the error stands.
    await refundAttempt(limiter, attempt, deps.reportRefundFailure);
    throw error;
  }
  if (!valid) {
    // A deletion or a credentials change that committed meanwhile removed what the check
    // looked for: not a guess, and the account is not the one this request authenticated.
    let current: User | null;
    try {
      current = await deps.users.findById(user.id);
    } catch (error) {
      // A fault is not a failed guess either: the units go back and the error stands.
      await refundAttempt(limiter, attempt, deps.reportRefundFailure);
      throw error;
    }
    if (!current || current.credentialsVersion !== user.credentialsVersion) {
      await refundAttempt(limiter, attempt, deps.reportRefundFailure);
      throw new Unauthenticated();
    }
    // A wrong code keeps its units and also counts toward the sign-in limit (NFR-01).
    await recordSignInFailure(limiter, user.email, deps.reportRecordFailure);
    throw new TotpInvalid();
  }
  await refundAttempt(limiter, attempt, deps.reportRefundFailure);
}

/**
 * The second-factor gate of actions other than sign-in: nothing is asked of a user with 2FA off;
 * with it on, a valid code is required, checked with the limits of disabling 2FA.
 */
export class RequireSecondFactor {
  constructor(private readonly deps: SecondFactorGateDependencies) {}

  async require(userId: string, code: string | undefined): Promise<void> {
    // The user is read before its 2FA settings, as in account deletion: a 2FA change that commits
    // in between bumped the credentials version, which the check compares after a wrong code.
    const user = await this.deps.users.findById(userId);
    if (!user) throw new Unauthenticated();
    const settings = await this.deps.twoFactor.findByUserId(userId);
    if (!settings?.enabledAt) return;
    await checkSecondFactor(this.deps, user, settings, code);
  }
}
