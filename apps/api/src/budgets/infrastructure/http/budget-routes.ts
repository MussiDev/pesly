import {
  budgetIdParamsSchema,
  budgetListResponseSchema,
  budgetResponseSchema,
  budgetSpendingListResponseSchema,
  budgetSpendingQuerySchema,
  budgetSpendingResponseSchema,
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
import { GetBudgetSpending } from '../../application/get-budget-spending';
import { ListBudgetSpending } from '../../application/list-budget-spending';
import { ListBudgets } from '../../application/list-budgets';
import type { BudgetVersionReader } from '../../application/ports/budget-version-reader';
import type { Clock } from '../../application/ports/clock';
import type { SpendingReader } from '../../application/ports/spending-reader';
import { UpdateBudget } from '../../application/update-budget';
import { SystemClock } from '../clock/system-clock';
import { DrizzleBudgetRepository } from '../db/drizzle-budget-repository';
import { DrizzleBudgetVersionReader } from '../db/drizzle-budget-version-reader';
import { DrizzleCategoryReader } from '../db/drizzle-category-reader';
import { DrizzleSpendingReader } from '../db/drizzle-spending-reader';
import { DrizzleUserTimeZone } from '../db/drizzle-user-time-zone';
import { presentBudget } from './budget-presenter';
import { presentBudgetSpending } from './spending-presenter';

export interface BudgetRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Defaults to the system clock; tests inject one to move "this month". */
  clock?: Clock;
  /** Default to the SQL readers; tests inject fakes. */
  versionReader?: BudgetVersionReader;
  spendingReader?: SpendingReader;
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
  versionReader = new DrizzleBudgetVersionReader(db),
  spendingReader = new DrizzleSpendingReader(db),
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
  const spendingDeps = {
    clock,
    timeZones: deps.timeZones,
    versions: versionReader,
    spending: spendingReader,
  };
  const listSpending = new ListBudgetSpending(spendingDeps);
  const getSpending = new GetBudgetSpending(spendingDeps);

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

    // Registered before `/budgets/:id` so "spending" is never read as an id.
    router.get(
      '/budgets/spending',
      validate(
        { query: budgetSpendingQuerySchema, response: budgetSpendingListResponseSchema },
        async ({ query }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'read');
          const result = await listSpending.execute(scope, query.month);
          logger.info({ requestId, userId: auth?.userId }, 'budget spending listed');
          res.json({ month: result.month, budgets: result.budgets.map(presentBudgetSpending) });
        },
      ),
    );

    router.get(
      '/budgets/:id/spending',
      validate(
        {
          params: budgetIdParamsSchema,
          query: budgetSpendingQuerySchema,
          response: budgetSpendingResponseSchema,
        },
        async ({ params, query }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'read');
          const spending = await getSpending.execute(scope, params.id, query.month);
          audit('budget spending read', requestId, auth, params.id);
          res.json(presentBudgetSpending(spending));
        },
      ),
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
