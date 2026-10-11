import {
  budgetIdParamsSchema,
  budgetListResponseSchema,
  budgetResponseSchema,
  createBudgetRequestSchema,
  updateBudgetRequestSchema,
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
import { CreateBudget } from '../../application/create-budget';
import { DeleteBudget } from '../../application/delete-budget';
import { GetBudget } from '../../application/get-budget';
import { ListBudgets } from '../../application/list-budgets';
import type { Clock } from '../../application/ports/clock';
import { UpdateBudget } from '../../application/update-budget';
import { SystemClock } from '../clock/system-clock';
import { DrizzleBudgetRepository } from '../db/drizzle-budget-repository';
import { DrizzleCategoryReader } from '../db/drizzle-category-reader';
import { DrizzleUserTimeZone } from '../db/drizzle-user-time-zone';
import { presentBudget } from './budget-presenter';

export interface BudgetRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Defaults to the system clock; tests inject one to move "this month". */
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

/** `/budgets`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createBudgetRoutes({
  db,
  logger,
  clock = new SystemClock(),
}: BudgetRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const deps = {
    budgets: new DrizzleBudgetRepository(db),
    categories: new DrizzleCategoryReader(db),
    timeZones: new DrizzleUserTimeZone(db),
    clock,
  };
  const create = new CreateBudget(deps);
  const list = new ListBudgets(deps);
  const get = new GetBudget(deps);
  const update = new UpdateBudget(deps);
  const remove = new DeleteBudget(deps);

  // Audit lines carry ids only: never the budget name or any amount.
  const audit = (
    message: string,
    requestId: string,
    auth: AuthContext | undefined,
    budgetId: string,
  ) => {
    logger.info({ requestId, userId: auth?.userId, budgetId }, message);
  };

  return ({ requireSession }) => {
    const router = Router();
    router.use('/budgets', requireSession, requireVerifiedEmail);

    router.post(
      '/budgets',
      validate(
        { body: createBudgetRequestSchema, response: budgetResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const created = await create.execute(scope, body);
          audit('budget created', requestId, auth, created.id);
          res.status(201).json(presentBudget(created));
        },
      ),
    );

    router.get(
      '/budgets',
      validate({ response: budgetListResponseSchema }, async (_input, { res, auth }) => {
        const scope = await scopeOf(policy, auth, 'read');
        res.json((await list.execute(scope)).map(presentBudget));
      }),
    );

    router.get(
      '/budgets/:id',
      validate(
        { params: budgetIdParamsSchema, response: budgetResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentBudget(await get.execute(scope, params.id)));
        },
      ),
    );

    router.patch(
      '/budgets/:id',
      validate(
        {
          params: budgetIdParamsSchema,
          body: updateBudgetRequestSchema,
          response: budgetResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const updated = await update.execute(scope, params.id, body);
          audit('budget changed', requestId, auth, updated.id);
          res.json(presentBudget(updated));
        },
      ),
    );

    router.delete(
      '/budgets/:id',
      validate({ params: budgetIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        await remove.execute(scope, params.id);
        audit('budget deleted', requestId, auth, params.id);
        res.sendStatus(204);
      }),
    );

    return router;
  };
}
