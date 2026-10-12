import {
  expensesByCategoryResponseSchema,
  incomeExpensesResponseSchema,
  netWorthQuerySchema,
  netWorthResponseSchema,
  reportFlowQuerySchema,
} from '@pesly/shared';
import { Router } from 'express';
import type { RouterFactory } from '../../../app';
import {
  OwnerOrGroupMemberAccessPolicy,
  type AccessAction,
  type AccessPolicy,
  type AccessScope,
} from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import type { AuthContext } from '../../../shared/http/auth-context';
import { HttpError } from '../../../shared/http/error-handler';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { Clock } from '../../application/ports/clock';
import type { ReportUseCases } from '../../application/ports/report-use-cases';

export interface ReportRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  useCases: ReportUseCases;
  /** Only the use cases read it; accepted so the composition root can share one clock. */
  clock?: Clock;
}

function scopeOf<A extends AccessAction>(
  policy: AccessPolicy,
  auth: AuthContext | undefined,
  action: A,
): Promise<AccessScope<A>> {
  // requireSession always sets auth before these routes; failing closed keeps that explicit.
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED');
  return policy.scopeFor(auth, action);
}

/** `/reports`: requireSession, requireVerifiedEmail, then the read-only use cases. */
export function createReportRoutes({ logger, useCases }: ReportRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

  return ({ requireSession }) => {
    const router = Router();
    router.use('/reports', requireSession, requireVerifiedEmail);

    router.get(
      '/reports/expenses-by-category',
      validate(
        { query: reportFlowQuerySchema, response: expensesByCategoryResponseSchema },
        async ({ query }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'read');
          const result = await useCases.expensesByCategory.execute(scope, query);
          // Ids only: never an amount, a tag or an account name.
          logger.info({ requestId, userId: auth?.userId }, 'expenses by category read');
          res.json(result);
        },
      ),
    );

    router.get(
      '/reports/income-expenses',
      validate(
        { query: reportFlowQuerySchema, response: incomeExpensesResponseSchema },
        async ({ query }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'read');
          const result = await useCases.incomeExpenses.execute(scope, query);
          logger.info({ requestId, userId: auth?.userId }, 'income and expenses read');
          res.json(result);
        },
      ),
    );

    router.get(
      '/reports/net-worth',
      validate(
        { query: netWorthQuerySchema, response: netWorthResponseSchema },
        async ({ query }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'read');
          const result = await useCases.netWorth.execute(scope, query);
          logger.info({ requestId, userId: auth?.userId }, 'net worth read');
          res.json(result);
        },
      ),
    );

    return router;
  };
}
