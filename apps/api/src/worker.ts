import {
  DolarapiRateProvider,
  FakeRateProvider,
  createRatesSyncJob,
  type RateProvider,
} from './exchange-rates';
import { createAutomaticDebitJob } from './credit-cards/jobs';
import { createEmailTransport, createEmailWorker } from './identity';
import {
  CoingeckoPriceProvider,
  FakePriceProvider,
  createInvestmentsJobs,
  type PriceProvider,
} from './investments/jobs';
import { createAutomaticDebitRecorder } from './movements';
import { createCardPayments } from './movements/infrastructure/credit-cards/drizzle-card-payments';
import { createCardPurchases } from './movements/infrastructure/credit-cards/drizzle-card-purchases';
import { createNoticePublisher } from './notices';
import { createRecurringExpenseRecorder } from './movements/infrastructure/recurring/drizzle-recurring-expense-recorder';
import { createRecurringJobs } from './recurring/jobs';
import { parseWorkerEnv } from './shared/config/env';
import { createDatabase } from './shared/db/client';
import { createLogger } from './shared/logging/logger';
import { createShutdown } from './shared/process/graceful-shutdown';

/**
 * Worker process: delivers the PostgreSQL outbox through the transport named by EMAIL_PROVIDER and
 * refreshes the exchange rates through the provider named by RATE_PROVIDER, refreshes crypto prices
 * through the one named by PRICE_PROVIDER and takes the daily portfolio snapshots, records the recurring payments that are due and the automatic debits of credit card statements. Run as many as
 * needed; row locks keep them from sending an email twice and the refresh claims keep each
 * provider to one call per hour.
 */
const env = parseWorkerEnv(process.env);
const logger = createLogger({ level: env.LOG_LEVEL });
const { db, pool } = createDatabase(env.DATABASE_URL);
const worker = createEmailWorker({
  db,
  env,
  logger,
  transport: createEmailTransport(env, logger),
});

const rateProvider: RateProvider =
  env.RATE_PROVIDER === 'fake'
    ? new FakeRateProvider()
    : new DolarapiRateProvider({ baseUrl: env.DOLARAPI_BASE_URL });
const ratesJob = createRatesSyncJob({ db, provider: rateProvider, logger });

const priceProvider: PriceProvider =
  env.PRICE_PROVIDER === 'fake'
    ? new FakePriceProvider()
    : new CoingeckoPriceProvider({
        baseUrl: env.COINGECKO_BASE_URL,
        apiKey: env.COINGECKO_API_KEY,
      });
const investmentsJobs = createInvestmentsJobs({ db, provider: priceProvider, logger });
if (env.PRICE_PROVIDER === 'coingecko' && !env.COINGECKO_API_KEY) {
  logger.info('crypto prices run without COINGECKO_API_KEY, on the public rate limit');
}

const recurringJobs = createRecurringJobs({
  db,
  logger,
  recorder: createRecurringExpenseRecorder(db, logger),
  notices: createNoticePublisher(db),
  intervalSeconds: env.RECURRING_JOB_INTERVAL_SECONDS,
});

const automaticDebitJob = createAutomaticDebitJob({
  db,
  logger,
  recorder: createAutomaticDebitRecorder(db, logger),
  cardPayments: createCardPayments(db),
  purchases: createCardPurchases(db),
  intervalSeconds: env.RECURRING_JOB_INTERVAL_SECONDS,
});

worker.start();
logger.info({ provider: env.EMAIL_PROVIDER }, 'email worker started');
ratesJob.start();
logger.info({ provider: env.RATE_PROVIDER }, 'rates sync started');
investmentsJobs.start();
logger.info({ provider: env.PRICE_PROVIDER }, 'price sync started');
logger.info('snapshot job started');
recurringJobs.start();
logger.info(
  { intervalSeconds: env.RECURRING_JOB_INTERVAL_SECONDS },
  'recurring payments job started',
);
automaticDebitJob.start();
logger.info({ intervalSeconds: env.RECURRING_JOB_INTERVAL_SECONDS }, 'automatic debit job started');

const shutdown = createShutdown({
  name: 'email worker',
  logger,
  close: async () => {
    await Promise.all([
      worker.stop(),
      ratesJob.stop(),
      investmentsJobs.stop(),
      recurringJobs.stop(),
      automaticDebitJob.stop(),
    ]);
    await pool.end();
  },
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
