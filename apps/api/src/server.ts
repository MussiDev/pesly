import { createAccountRoutes } from './accounts';
import { createApp } from './app';
import { createCategoryRoutes, seedDefaultCategories } from './categories';
// Deep import on purpose: the exchange-rates barrel would load the providers and the sync job into the API process (NFR-03, R-08).
import { createExchangeRateRoutes } from './exchange-rates/infrastructure/http/exchange-rate-routes';
import { createInvestmentsRoutes } from './investments';
import {
  createAccountMovements,
  createCategoryUsage,
  createMovementRoutes,
  createTagRoutes,
  eraseUserMovements,
} from './movements';
import { parseEnv } from './shared/config/env';
import { createDatabase } from './shared/db/client';
import { createLogger } from './shared/logging/logger';
import { createShutdown } from './shared/process/graceful-shutdown';

const env = parseEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL });
const { db, pool } = createDatabase(env.DATABASE_URL);
const app = createApp({
  env,
  logger,
  // The composition root is the only place that knows these modules: new accounts get their default
  // categories in the transaction that creates them, and erasing a user deletes their movements
  // first because their keys to accounts and categories restrict.
  identity: { db, onUserCreated: [seedDefaultCategories], beforeUserErased: [eraseUserMovements] },
  routerFactories: [
    createAccountRoutes({ db, logger, movements: createAccountMovements(db) }),
    createCategoryRoutes({ db, logger, usage: createCategoryUsage(db) }),
    createExchangeRateRoutes({ db }),
    createInvestmentsRoutes({ db, logger }),
    createMovementRoutes({ db, logger }),
    createTagRoutes({ db }),
  ],
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'api listening');
});

const shutdown = createShutdown({
  name: 'api',
  logger,
  close: async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await pool.end();
  },
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
