import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type RequestHandler, type Router } from 'express';
import helmet from 'helmet';
import {
  createIdentityModule,
  type BreachedPasswordChecker,
  type Clock,
  type IdentityDb,
  type UserCreatedHook,
  type UserErasureStep,
} from './identity';
import type { Env } from './shared/config/env';
import { createErrorHandler, HttpError } from './shared/http/error-handler';
import { healthRoutes } from './shared/http/health-routes';
import { createOriginGuard } from './shared/http/origin-guard';
import type { Logger } from './shared/logging/logger';

export const JSON_BODY_LIMIT = '16kb';
/** A statement import carries up to 300 lines (about 400 bytes each at most), so it gets its own cap. */
export const STATEMENT_IMPORT_BODY_LIMIT = '192kb';
const STATEMENT_IMPORT_PATH = /^\/credit-cards\/[^/]+\/statement-imports\/?$/;
/** A holdings import carries up to 1,000 rows (about 250 bytes each), so it gets its own cap. */
export const HOLDINGS_IMPORT_BODY_LIMIT = '384kb';
const HOLDINGS_IMPORT_PATH = /^\/investments\/portfolios\/[^/]+\/holdings\/import\/?$/;

export interface IdentityModuleOptions {
  db: IdentityDb;
  clock?: Clock;
  /**
   * Test seam: replaces the real `requireSession` (JWT + live session row) on the identity
   * module's authenticated routes.
   */
  requireSession?: RequestHandler;
  /** Test seam: replaces the breach checker selected by `BREACH_CHECKER`. */
  breachedPasswordChecker?: BreachedPasswordChecker;
  /** Hooks run inside the transaction that creates a user; the composition root registers them. */
  onUserCreated?: readonly UserCreatedHook[];
  /** Steps run inside the erasure transaction before the user is deleted; the composition root registers them. */
  beforeUserErased?: readonly UserErasureStep[];
}

/** What the app hands to other modules' router factories. */
export interface AppModules {
  /** The identity module's real session middleware; sets `req.auth` or answers 401. */
  requireSession: RequestHandler;
}

/** Builds a module's router once the modules it depends on exist. */
export type RouterFactory = (modules: AppModules) => Router;

export interface AppDependencies {
  env: Env;
  logger: Logger;
  /** When given, the identity module's routes are mounted. */
  identity?: IdentityModuleOptions;
  /** Module routers, mounted after the cross-cutting middleware and before the error handler. */
  routers?: Router[];
  /**
   * Routers that need other modules (e.g. `requireSession`); built after the identity module and
   * mounted after `routers`. Requires `identity`.
   */
  routerFactories?: RouterFactory[];
  /**
   * Test-only routers (e.g. the access-control fixture resource). Built and mounted, after
   * `routerFactories`, only when NODE_ENV is `test`; in any other environment they are ignored,
   * never even built. Requires `identity`.
   */
  testRouterFactories?: RouterFactory[];
}

function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      logger.info(
        {
          requestId,
          method: req.method,
          route: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'request completed',
      );
    });
    next();
  };
}

/**
 * TLS ends at the hosting edge; in production any request the edge did not receive over HTTPS is
 * refused (NFR-07). `req.secure` only honours X-Forwarded-Proto from the trusted proxy hops
 * configured in TRUST_PROXY, so a client cannot claim https by sending the header itself.
 */
function httpsGuard(env: Env): RequestHandler {
  return (req, _res, next) => {
    if (env.NODE_ENV !== 'production' || req.secure) {
      next();
      return;
    }
    next(new HttpError(400, 'VALIDATION_FAILED'));
  };
}

export function createApp({
  env,
  logger,
  identity,
  routers = [],
  routerFactories = [],
  testRouterFactories = [],
}: AppDependencies): Express {
  if ((routerFactories.length > 0 || testRouterFactories.length > 0) && !identity) {
    throw new Error('Router factories need the identity module (it provides requireSession)');
  }
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestContext(logger));
  app.use(helmet());
  // A browser on the web origin hides Retry-After from scripts unless it is exposed.
  app.use(cors({ origin: [env.WEB_ORIGIN], credentials: true, exposedHeaders: ['Retry-After'] }));
  // Before the HTTPS guard: platform health probes call it over plain HTTP inside the network.
  app.use(healthRoutes());
  app.use(httpsGuard(env));
  app.use(createOriginGuard(env.WEB_ORIGIN));
  const parseJson = express.json({ limit: JSON_BODY_LIMIT });
  const parseStatementImportJson = express.json({ limit: STATEMENT_IMPORT_BODY_LIMIT });
  const parseHoldingsImportJson = express.json({ limit: HOLDINGS_IMPORT_BODY_LIMIT });
  app.use((req, res, next) => {
    const post = req.method === 'POST';
    if (post && STATEMENT_IMPORT_PATH.test(req.path)) parseStatementImportJson(req, res, next);
    else if (post && HOLDINGS_IMPORT_PATH.test(req.path)) parseHoldingsImportJson(req, res, next);
    else parseJson(req, res, next);
  });
  app.use(cookieParser());

  if (identity) {
    const identityModule = createIdentityModule({
      db: identity.db,
      env,
      logger,
      ...(identity.clock ? { clock: identity.clock } : {}),
      requireSession: identity.requireSession,
      breachedPasswordChecker: identity.breachedPasswordChecker,
      ...(identity.onUserCreated ? { onUserCreated: identity.onUserCreated } : {}),
      ...(identity.beforeUserErased ? { beforeUserErased: identity.beforeUserErased } : {}),
    });
    for (const router of identityModule.routers) app.use(router);
    for (const router of routers) app.use(router);
    const modules: AppModules = { requireSession: identityModule.requireSession };
    for (const factory of routerFactories) app.use(factory(modules));
    if (env.NODE_ENV === 'test') {
      for (const factory of testRouterFactories) app.use(factory(modules));
    }
  } else {
    for (const router of routers) app.use(router);
  }

  app.use((_req, _res, next) => {
    next(new HttpError(404, 'NOT_FOUND'));
  });
  app.use(createErrorHandler(logger));

  return app;
}
