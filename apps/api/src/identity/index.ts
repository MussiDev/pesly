import type { RequestHandler, Router } from 'express';
import type { Env } from '../shared/config/env';
import { createRequireSession } from '../shared/http/require-session';
import type { Logger } from '../shared/logging/logger';
import { CompleteDeletionReauth } from './application/complete-deletion-reauth';
import { CompleteGoogleSignIn } from './application/complete-google-sign-in';
import { ConfirmPasswordReset } from './application/confirm-password-reset';
import { CreateSignInChallenge } from './application/create-sign-in-challenge';
import { DeleteUser } from './application/delete-user';
import { DisableTwoFactor } from './application/disable-two-factor';
import { EnableTwoFactor } from './application/enable-two-factor';
import { GetCurrentSession } from './application/get-current-session';
import { GetProfile } from './application/get-profile';
import { GetTwoFactorStatus } from './application/get-two-factor-status';
import { RefreshSession } from './application/refresh-session';
import { RegisterUser } from './application/register-user';
import { RequestPasswordReset } from './application/request-password-reset';
import { RequireSecondFactor } from './application/require-second-factor';
import { ResendVerification } from './application/resend-verification';
import { SignIn } from './application/sign-in';
import { SignOut } from './application/sign-out';
import { SignOutAll } from './application/sign-out-all';
import { StartDeletionReauth } from './application/start-deletion-reauth';
import { StartGoogleSignIn } from './application/start-google-sign-in';
import { StartSession } from './application/start-session';
import { StartTwoFactorSetup } from './application/start-two-factor-setup';
import { UpdateProfile } from './application/update-profile';
import { VerifyEmail } from './application/verify-email';
import { VerifySecondFactor } from './application/verify-second-factor';
import type { AttemptLimiter } from './application/ports/attempt-limiter';
import type { AttemptPurger } from './application/ports/attempt-purger';
import type { BreachedPasswordChecker } from './application/ports/breached-password-checker';
import type { Clock } from './application/ports/clock';
import type {
  DeletionGrantPurger,
  DeletionGrantRepository,
} from './application/ports/deletion-grant-repository';
import type { EmailSender } from './application/ports/email-sender';
import type { GoogleIdentityProvider } from './application/ports/google-identity-provider';
import type { OAuthStatePurger } from './application/ports/oauth-state-purger';
import type { OAuthStateRepository } from './application/ports/oauth-state-repository';
import type { OneTimeTokenRepository } from './application/ports/one-time-token-repository';
import type { PasswordHasher } from './application/ports/password-hasher';
import type { ProfileRepository } from './application/ports/profile-repository';
import type { RecoveryCodeGenerator } from './application/ports/recovery-code-generator';
import type { RecoveryCodeRepository } from './application/ports/recovery-code-repository';
import type { SecretBox } from './application/ports/secret-box';
import type { SessionRepository } from './application/ports/session-repository';
import type { SignInChallengePurger } from './application/ports/sign-in-challenge-purger';
import type { SignInChallengeRepository } from './application/ports/sign-in-challenge-repository';
import type { TokenGenerator } from './application/ports/token-generator';
import type { TotpEngine } from './application/ports/totp';
import type { TwoFactorRepository } from './application/ports/two-factor-repository';
import type { UnitOfWork } from './application/ports/unit-of-work';
import type { UserDeletionRepository } from './application/ports/user-deletion-repository';
import type { UserIdentityRepository } from './application/ports/user-identity-repository';
import type { UserRepository } from './application/ports/user-repository';
import { DrizzleDeletionGrantRepository } from './infrastructure/db/drizzle-deletion-grant-repository';
import { DrizzleOAuthStateRepository } from './infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleOneTimeTokenRepository } from './infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleProfileRepository } from './infrastructure/db/drizzle-profile-repository';
import { DrizzleRecoveryCodeRepository } from './infrastructure/db/drizzle-recovery-code-repository';
import { DrizzleSessionRepository } from './infrastructure/db/drizzle-session-repository';
import { DrizzleSignInChallengeRepository } from './infrastructure/db/drizzle-sign-in-challenge-repository';
import { DrizzleTwoFactorRepository } from './infrastructure/db/drizzle-two-factor-repository';
import { DrizzleUnitOfWork } from './infrastructure/db/drizzle-unit-of-work';
import { DrizzleUserDeletionRepository } from './infrastructure/db/drizzle-user-deletion-repository';
import { DrizzleUserIdentityRepository } from './infrastructure/db/drizzle-user-identity-repository';
import { DrizzleUserRepository } from './infrastructure/db/drizzle-user-repository';
import { PostgresAttemptLimiter } from './infrastructure/db/postgres-attempt-limiter';
import type { IdentityDb } from './infrastructure/db/schema';
import type { UserCreatedHook } from './infrastructure/db/user-created-hook';
import type { UserErasureStep } from './infrastructure/db/user-erasure-step';
import type { EmailTransport } from './infrastructure/email/email-transport';
import { EmailWorker } from './infrastructure/email/email-worker';
import { OutboxEmailSender } from './infrastructure/email/outbox-email-sender';
import { createGoogleRoutes } from './infrastructure/http/google-routes';
import { createPasswordResetRoutes } from './infrastructure/http/password-reset-routes';
import { createRegistrationRoutes } from './infrastructure/http/registration-routes';
import { ACCESS_TOKEN_COOKIE } from './infrastructure/http/session-cookies';
import { createSessionRoutes } from './infrastructure/http/session-routes';
import { createProfileRoutes } from './infrastructure/http/profile-routes';
import { createTwoFactorRoutes } from './infrastructure/http/two-factor-routes';
import {
  AesGcmSecretBox,
  UnavailableSecretBox,
} from './infrastructure/security/aes-gcm-secret-box';
import {
  Argon2idPasswordHasher,
  DUMMY_PASSWORD_HASH,
} from './infrastructure/security/argon2id-password-hasher';
import { CryptoRecoveryCodeGenerator } from './infrastructure/security/crypto-recovery-code-generator';
import { CryptoTokenGenerator } from './infrastructure/security/crypto-token-generator';
import { FakeBreachedPasswordChecker } from './infrastructure/security/fake-breached-password-checker';
import { GoogleOidcIdentityProvider } from './infrastructure/security/google-oidc-identity-provider';
import { HibpBreachedPasswordChecker } from './infrastructure/security/hibp-breached-password-checker';
import { JoseAccessTokenIssuer } from './infrastructure/security/jose-access-token-issuer';
import { RfcTotpEngine } from './infrastructure/security/totp';
import { UnconfiguredGoogleIdentityProvider } from './infrastructure/security/unconfigured-google-identity-provider';
import { systemClock } from './infrastructure/system-clock';

export * from './domain/account-defaults';
export * from './domain/email';
export * from './domain/errors';
export * from './domain/password-rules';
export * from './domain/recovery-code';
export * from './application/ports/access-token-issuer';
export * from './application/ports/attempt-limiter';
export * from './application/ports/attempt-purger';
export * from './application/ports/breached-password-checker';
export * from './application/ports/clock';
export * from './application/ports/deletion-grant-repository';
export * from './application/ports/email-sender';
export * from './application/ports/google-identity-provider';
export * from './application/ports/oauth-state-purger';
export * from './application/ports/oauth-state-repository';
export * from './application/ports/one-time-token-repository';
export * from './application/ports/password-hasher';
export * from './application/ports/profile-repository';
export * from './application/ports/recovery-code-generator';
export * from './application/ports/recovery-code-repository';
export * from './application/ports/secret-box';
export * from './application/ports/session-repository';
export * from './application/ports/sign-in-challenge-purger';
export * from './application/ports/sign-in-challenge-repository';
export * from './application/ports/token-generator';
export * from './application/ports/totp';
export * from './application/ports/two-factor-repository';
export * from './application/ports/unit-of-work';
export * from './application/ports/user-deletion-repository';
export * from './application/ports/user-identity-repository';
export * from './application/ports/user-repository';
export { RequireSecondFactor } from './application/require-second-factor';
export type { IdentityDb } from './infrastructure/db/schema';
export type { UserCreatedHook } from './infrastructure/db/user-created-hook';
export type { UserErasureStep } from './infrastructure/db/user-erasure-step';
export { systemClock } from './infrastructure/system-clock';
export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './infrastructure/http/session-cookies';
export { createEmailTransport } from './infrastructure/email/email-transport';
export type { EmailTransport } from './infrastructure/email/email-transport';
export type { EmailWorker } from './infrastructure/email/email-worker';

export interface IdentityInfrastructureDependencies {
  /** The application database; a transaction is accepted too. */
  db: IdentityDb;
  env: Pick<Env, 'BREACH_CHECKER' | 'TOTP_ENCRYPTION_KEY'>;
  logger: Logger;
  clock?: Clock;
  /**
   * Run, in order, inside the transaction that creates a user (registration and Google sign-up),
   * so other modules can provision a new account; a rejection rolls the creation back.
   */
  onUserCreated?: readonly UserCreatedHook[];
  /**
   * Run, in order, inside the transaction that erases a user, before the user row is deleted, so
   * other modules can delete rows whose keys restrict; a rejection rolls the erasure back.
   */
  beforeUserErased?: readonly UserErasureStep[];
}

export interface IdentityInfrastructure {
  clock: Clock;
  users: UserRepository;
  profiles: ProfileRepository;
  sessions: SessionRepository;
  oneTimeTokens: OneTimeTokenRepository;
  identities: UserIdentityRepository;
  oauthStates: OAuthStateRepository;
  oauthStatePurger: OAuthStatePurger;
  attemptLimiter: AttemptLimiter;
  attemptPurger: AttemptPurger;
  passwordHasher: PasswordHasher;
  breachedPasswordChecker: BreachedPasswordChecker;
  tokenGenerator: TokenGenerator;
  emailSender: EmailSender;
  unitOfWork: UnitOfWork;
  twoFactor: TwoFactorRepository;
  recoveryCodes: RecoveryCodeRepository;
  signInChallenges: SignInChallengeRepository;
  signInChallengePurger: SignInChallengePurger;
  deletionGrants: DeletionGrantRepository;
  deletionGrantPurger: DeletionGrantPurger;
  userDeletion: UserDeletionRepository;
  totp: TotpEngine;
  /** Seals TOTP secrets; unavailable (every call throws) when no key is configured. */
  secretBox: SecretBox;
  recoveryCodeGenerator: RecoveryCodeGenerator;
}

/** Composition root of the identity module's adapters. */
export function createIdentityInfrastructure({
  db,
  env,
  logger,
  clock = systemClock,
  onUserCreated,
  beforeUserErased,
}: IdentityInfrastructureDependencies): IdentityInfrastructure {
  const attemptLimiter = new PostgresAttemptLimiter(db, clock);
  const oauthStates = new DrizzleOAuthStateRepository(db);
  const signInChallenges = new DrizzleSignInChallengeRepository(db);
  const deletionGrants = new DrizzleDeletionGrantRepository(db);
  return {
    clock,
    users: new DrizzleUserRepository(db),
    profiles: new DrizzleProfileRepository(db),
    sessions: new DrizzleSessionRepository(db),
    oneTimeTokens: new DrizzleOneTimeTokenRepository(db),
    identities: new DrizzleUserIdentityRepository(db),
    oauthStates,
    oauthStatePurger: oauthStates,
    attemptLimiter,
    attemptPurger: attemptLimiter,
    passwordHasher: new Argon2idPasswordHasher({ logger }),
    breachedPasswordChecker:
      env.BREACH_CHECKER === 'fake'
        ? new FakeBreachedPasswordChecker()
        : new HibpBreachedPasswordChecker({ logger }),
    tokenGenerator: new CryptoTokenGenerator(),
    emailSender: new OutboxEmailSender(db, clock),
    unitOfWork: new DrizzleUnitOfWork(db, clock, onUserCreated),
    twoFactor: new DrizzleTwoFactorRepository(db),
    recoveryCodes: new DrizzleRecoveryCodeRepository(db),
    signInChallenges,
    signInChallengePurger: signInChallenges,
    deletionGrants,
    deletionGrantPurger: deletionGrants,
    userDeletion: new DrizzleUserDeletionRepository(db, beforeUserErased),
    totp: new RfcTotpEngine(),
    secretBox: env.TOTP_ENCRYPTION_KEY
      ? new AesGcmSecretBox(env.TOTP_ENCRYPTION_KEY)
      : new UnavailableSecretBox(),
    recoveryCodeGenerator: new CryptoRecoveryCodeGenerator(),
  };
}

export interface IdentityModuleDependencies extends Omit<
  IdentityInfrastructureDependencies,
  'env'
> {
  env: Pick<
    Env,
    | 'BREACH_CHECKER'
    | 'JWT_SECRET'
    | 'API_ORIGIN'
    | 'WEB_BASE_URL'
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
    | 'GOOGLE_AUTHORIZATION_URL'
    | 'GOOGLE_TOKEN_URL'
    | 'GOOGLE_JWKS_URL'
    | 'GOOGLE_ISSUER'
    | 'TOTP_ENCRYPTION_KEY'
  >;
  /**
   * Test seam: replaces the real `requireSession` on the identity module's authenticated routes.
   * It must set `req.auth`.
   */
  requireSession?: RequestHandler | undefined;
  /** Test seam: replaces the breach checker selected by `BREACH_CHECKER`. */
  breachedPasswordChecker?: BreachedPasswordChecker | undefined;
}

export interface IdentityModule {
  /** The identity module's HTTP routers, wired to their use cases and adapters. */
  routers: Router[];
  /**
   * The real session middleware (JWT + live session row + existing user), for every module's
   * authenticated routes. Sets `req.auth`; answers 401 `UNAUTHENTICATED` otherwise.
   */
  requireSession: RequestHandler;
  /**
   * For other modules' sensitive writes: asks a valid second-factor code of a user who has 2FA on,
   * with the limits of disabling 2FA, and nothing of a user who has it off.
   */
  secondFactorGate: RequireSecondFactor;
}

/**
 * Google sign-in as configured. Built once per module: the adapter caches Google's signing keys.
 * Without a client id (only possible outside production) every Google sign-in fails.
 */
function createGoogleIdentityProvider(
  env: IdentityModuleDependencies['env'],
  tokenGenerator: TokenGenerator,
): GoogleIdentityProvider {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new UnconfiguredGoogleIdentityProvider();
  }
  return new GoogleOidcIdentityProvider({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    apiOrigin: env.API_ORIGIN,
    authorizationUrl: env.GOOGLE_AUTHORIZATION_URL,
    tokenUrl: env.GOOGLE_TOKEN_URL,
    jwksUrl: env.GOOGLE_JWKS_URL,
    issuer: env.GOOGLE_ISSUER,
    tokenGenerator,
  });
}

/** Composition root of the identity module: its routers and the shared `requireSession`. */
export function createIdentityModule({
  requireSession: requireSessionOverride,
  breachedPasswordChecker,
  env,
  ...dependencies
}: IdentityModuleDependencies): IdentityModule {
  const identity = createIdentityInfrastructure({ ...dependencies, env });
  const accessTokens = new JoseAccessTokenIssuer({ secret: env.JWT_SECRET, clock: identity.clock });
  const getCurrentSession = new GetCurrentSession({
    accessTokens,
    sessions: identity.sessions,
    users: identity.users,
    clock: identity.clock,
  });
  const requireSession = createRequireSession({
    cookieName: ACCESS_TOKEN_COOKIE,
    authenticate: async (accessToken) => {
      const current = await getCurrentSession.execute(accessToken);
      return current
        ? {
            userId: current.user.id,
            sessionId: current.sessionId,
            emailVerified: current.user.emailVerifiedAt !== null,
          }
        : null;
    },
  });
  const routeSession = requireSessionOverride ?? requireSession;
  const startSession = new StartSession({
    sessions: identity.sessions,
    tokenGenerator: identity.tokenGenerator,
    accessTokens,
    clock: identity.clock,
  });
  const google = createGoogleIdentityProvider(env, identity.tokenGenerator);
  const createSignInChallenge = new CreateSignInChallenge({
    signInChallenges: identity.signInChallenges,
    tokenGenerator: identity.tokenGenerator,
    clock: identity.clock,
  });
  const reportRecordFailure = (error: unknown) => {
    dependencies.logger.warn(
      { err: error },
      'failed second-factor code not recorded on the sign-in limit',
    );
  };
  // After 2FA is turned on or off every session has ended; without a new one the user signs in again.
  const reportReissueFailure = (change: 'enable' | 'disable') => (error: unknown) => {
    dependencies.logger.error(
      { err: error, change },
      'session re-issue after a two-factor change failed; the user must sign in again',
    );
  };

  const getTwoFactorStatus = new GetTwoFactorStatus({
    twoFactor: identity.twoFactor,
    recoveryCodes: identity.recoveryCodes,
  });

  const routers = [
    createRegistrationRoutes({
      registerUser: new RegisterUser({
        attemptLimiter: identity.attemptLimiter,
        breachedPasswordChecker: breachedPasswordChecker ?? identity.breachedPasswordChecker,
        passwordHasher: identity.passwordHasher,
        dummyPasswordHash: DUMMY_PASSWORD_HASH,
        users: identity.users,
        emailSender: identity.emailSender,
        unitOfWork: identity.unitOfWork,
      }),
      verifyEmail: new VerifyEmail({
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
        unitOfWork: identity.unitOfWork,
      }),
      resendVerification: new ResendVerification({
        attemptLimiter: identity.attemptLimiter,
        users: identity.users,
        emailSender: identity.emailSender,
      }),
      requireSession: routeSession,
      logger: dependencies.logger,
    }),
    createSessionRoutes({
      signIn: new SignIn({
        attemptLimiter: identity.attemptLimiter,
        users: identity.users,
        passwordHasher: identity.passwordHasher,
        dummyPasswordHash: DUMMY_PASSWORD_HASH,
        startSession,
        twoFactor: identity.twoFactor,
        createSignInChallenge,
        reportRefundFailure: (error) => {
          // `err` goes through the logger's safe serializer (no query params or row values).
          dependencies.logger.warn(
            { err: error },
            'sign-in limit refund failed; the reserved units stay counted',
          );
        },
      }),
      refreshSession: new RefreshSession({
        sessions: identity.sessions,
        users: identity.users,
        tokenGenerator: identity.tokenGenerator,
        accessTokens,
        unitOfWork: identity.unitOfWork,
        clock: identity.clock,
      }),
      signOut: new SignOut({
        sessions: identity.sessions,
        tokenGenerator: identity.tokenGenerator,
        accessTokens,
        clock: identity.clock,
      }),
      signOutAll: new SignOutAll({ sessions: identity.sessions, clock: identity.clock }),
      getCurrentSession,
      requireSession: routeSession,
      logger: dependencies.logger,
    }),
    createPasswordResetRoutes({
      requestPasswordReset: new RequestPasswordReset({
        attemptLimiter: identity.attemptLimiter,
        users: identity.users,
        emailSender: identity.emailSender,
      }),
      confirmPasswordReset: new ConfirmPasswordReset({
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
        breachedPasswordChecker: breachedPasswordChecker ?? identity.breachedPasswordChecker,
        passwordHasher: identity.passwordHasher,
        unitOfWork: identity.unitOfWork,
      }),
      logger: dependencies.logger,
    }),
    createGoogleRoutes({
      startGoogleSignIn: new StartGoogleSignIn({
        attemptLimiter: identity.attemptLimiter,
        oauthStates: identity.oauthStates,
        google,
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
      }),
      completeGoogleSignIn: new CompleteGoogleSignIn({
        oauthStates: identity.oauthStates,
        google,
        tokenGenerator: identity.tokenGenerator,
        unitOfWork: identity.unitOfWork,
        startSession,
        createSignInChallenge,
        completeDeletionReauth: new CompleteDeletionReauth({
          identities: identity.identities,
          sessions: identity.sessions,
          deletionGrants: identity.deletionGrants,
          tokenGenerator: identity.tokenGenerator,
          clock: identity.clock,
        }),
        clock: identity.clock,
      }),
      webBaseUrl: env.WEB_BASE_URL,
      logger: dependencies.logger,
    }),
    createTwoFactorRoutes({
      getTwoFactorStatus,
      startTwoFactorSetup: new StartTwoFactorSetup({
        users: identity.users,
        twoFactor: identity.twoFactor,
        totp: identity.totp,
        secretBox: identity.secretBox,
      }),
      enableTwoFactor: new EnableTwoFactor({
        users: identity.users,
        twoFactor: identity.twoFactor,
        totp: identity.totp,
        secretBox: identity.secretBox,
        recoveryCodeGenerator: identity.recoveryCodeGenerator,
        passwordHasher: identity.passwordHasher,
        unitOfWork: identity.unitOfWork,
        startSession,
        clock: identity.clock,
        reportReissueFailure: reportReissueFailure('enable'),
      }),
      disableTwoFactor: new DisableTwoFactor({
        users: identity.users,
        twoFactor: identity.twoFactor,
        recoveryCodes: identity.recoveryCodes,
        totp: identity.totp,
        secretBox: identity.secretBox,
        passwordHasher: identity.passwordHasher,
        attemptLimiter: identity.attemptLimiter,
        unitOfWork: identity.unitOfWork,
        startSession,
        clock: identity.clock,
        reportRefundFailure: (error) => {
          dependencies.logger.warn(
            { err: error },
            'two-factor disable limit refund failed; the reserved units stay counted',
          );
        },
        reportRecordFailure,
        reportReissueFailure: reportReissueFailure('disable'),
      }),
      verifySecondFactor: new VerifySecondFactor({
        signInChallenges: identity.signInChallenges,
        tokenGenerator: identity.tokenGenerator,
        attemptLimiter: identity.attemptLimiter,
        unitOfWork: identity.unitOfWork,
        startSession,
        totp: identity.totp,
        secretBox: identity.secretBox,
        passwordHasher: identity.passwordHasher,
        clock: identity.clock,
        reportRefundFailure: (error) => {
          dependencies.logger.warn(
            { err: error },
            'second-factor limit refund failed; the reserved units stay counted',
          );
        },
        reportRecordFailure,
      }),
      requireSession: routeSession,
      logger: dependencies.logger,
    }),
    createProfileRoutes({
      getProfile: new GetProfile({
        profiles: identity.profiles,
        twoFactorStatus: getTwoFactorStatus,
      }),
      updateProfile: new UpdateProfile({
        profiles: identity.profiles,
        twoFactorStatus: getTwoFactorStatus,
      }),
      deleteUser: new DeleteUser({
        users: identity.users,
        twoFactor: identity.twoFactor,
        recoveryCodes: identity.recoveryCodes,
        totp: identity.totp,
        secretBox: identity.secretBox,
        passwordHasher: identity.passwordHasher,
        attemptLimiter: identity.attemptLimiter,
        userDeletion: identity.userDeletion,
        sessions: identity.sessions,
        deletionGrants: identity.deletionGrants,
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
        reportRefundFailure: (error) => {
          dependencies.logger.warn(
            { err: error },
            'account deletion limit refund failed; the reserved units stay counted',
          );
        },
        reportRecordFailure,
      }),
      startDeletionReauth: new StartDeletionReauth({
        attemptLimiter: identity.attemptLimiter,
        users: identity.users,
        sessions: identity.sessions,
        oauthStates: identity.oauthStates,
        google,
        tokenGenerator: identity.tokenGenerator,
        clock: identity.clock,
      }),
      requireSession: routeSession,
      logger: dependencies.logger,
    }),
  ];
  const secondFactorGate = new RequireSecondFactor({
    users: identity.users,
    twoFactor: identity.twoFactor,
    recoveryCodes: identity.recoveryCodes,
    totp: identity.totp,
    secretBox: identity.secretBox,
    passwordHasher: identity.passwordHasher,
    attemptLimiter: identity.attemptLimiter,
    clock: identity.clock,
    reportRefundFailure: (error) => {
      dependencies.logger.warn(
        { err: error },
        'second-factor limit refund failed; the reserved units stay counted',
      );
    },
    reportRecordFailure,
  });
  return { routers, requireSession, secondFactorGate };
}

export interface EmailWorkerFactoryDependencies {
  /** A database (not a transaction): the worker opens one transaction per outbox row. */
  db: IdentityDb;
  env: Pick<Env, 'WEB_BASE_URL'>;
  logger: Logger;
  transport: EmailTransport;
  clock?: Clock;
  pollIntervalMs?: number;
}

/**
 * The outbox worker, with the PostgreSQL attempt, OAuth-state, sign-in challenge and deletion grant
 * purgers and the crypto token generator.
 */
export function createEmailWorker({
  db,
  env,
  logger,
  transport,
  clock = systemClock,
  pollIntervalMs,
}: EmailWorkerFactoryDependencies): EmailWorker {
  return new EmailWorker({
    db,
    transport,
    tokenGenerator: new CryptoTokenGenerator(),
    attemptPurger: new PostgresAttemptLimiter(db, clock),
    oauthStatePurger: new DrizzleOAuthStateRepository(db),
    signInChallengePurger: new DrizzleSignInChallengeRepository(db),
    deletionGrantPurger: new DrizzleDeletionGrantRepository(db),
    clock,
    logger,
    webBaseUrl: env.WEB_BASE_URL,
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
  });
}
