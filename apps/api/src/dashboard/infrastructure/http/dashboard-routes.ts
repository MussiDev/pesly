import { dashboardQuerySchema, dashboardResponseSchema } from '@pesly/shared';
import { Router } from 'express';
import type { RouterFactory } from '../../../app';
import type { Clock } from '../../../reports';
import { OwnerOrGroupMemberAccessPolicy } from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import { HttpError } from '../../../shared/http/error-handler';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import type { DashboardUseCase } from '../../application/ports/dashboard-use-case';

export interface DashboardRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  useCase: DashboardUseCase;
  /** Only the use case reads it; accepted so the composition root can share one clock. */
  clock?: Clock;
}

/** `/dashboard`: requireSession, requireVerifiedEmail, then the read-only use case. */
export function createDashboardRoutes({ logger, useCase }: DashboardRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

  return ({ requireSession }) => {
    const router = Router();
    router.use('/dashboard', requireSession, requireVerifiedEmail);

    router.get(
      '/dashboard',
      validate(
        { query: dashboardQuerySchema, response: dashboardResponseSchema },
        async (_input, { res, auth, requestId }) => {
          // requireSession always sets auth before this route; failing closed keeps that explicit.
          if (!auth) throw new HttpError(401, 'UNAUTHENTICATED');
          const scope = await policy.scopeFor(auth, 'read');
          const result = await useCase.execute(scope);
          // Ids only: never an amount or a name.
          logger.info({ requestId, userId: auth.userId }, 'dashboard read');
          res.json(result);
        },
      ),
    );

    return router;
  };
}
