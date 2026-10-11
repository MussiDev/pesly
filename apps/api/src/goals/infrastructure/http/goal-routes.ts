import {
  createGoalEntryRequestSchema,
  createGoalRequestSchema,
  goalIdParamsSchema,
  goalResponseSchema,
  listGoalEntriesQuerySchema,
  listGoalEntriesResponseSchema,
  listGoalsResponseSchema,
  recordGoalEntryResponseSchema,
  updateGoalRequestSchema,
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
import { CreateGoal } from '../../application/create-goal';
import { DeleteGoal } from '../../application/delete-goal';
import { GetGoal } from '../../application/get-goal';
import { ListGoalEntries } from '../../application/list-goal-entries';
import { ListGoals } from '../../application/list-goals';
import type { Clock } from '../../application/ports/clock';
import { RecordGoalEntry } from '../../application/record-goal-entry';
import { UpdateGoal } from '../../application/update-goal';
import { DrizzleAccountBalances } from '../db/drizzle-account-balances';
import { DrizzleGoalRepository } from '../db/drizzle-goal-repository';
import { DrizzleUserTimeZone } from '../db/drizzle-user-time-zone';
import { SystemClock } from '../system-clock';
import {
  presentGoal,
  presentGoalEntries,
  presentGoalList,
  presentRecordedEntry,
} from './goal-presenter';

export interface GoalRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Movement sums per account, from the movements module (`createAccountMovements(db)`). */
  movements: { sumsByAccount(accountIds: readonly string[]): Promise<ReadonlyMap<string, bigint>> };
  /** Defaults to the system clock; tests inject one to move "today". */
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

/** `/goals`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createGoalRoutes({
  db,
  logger,
  movements,
  clock = new SystemClock(),
}: GoalRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const deps = {
    goals: new DrizzleGoalRepository(db),
    accounts: new DrizzleAccountBalances(db, (ids) => movements.sumsByAccount(ids)),
    timeZones: new DrizzleUserTimeZone(db),
    clock,
  };
  const create = new CreateGoal(deps);
  const list = new ListGoals(deps);
  const get = new GetGoal(deps);
  const update = new UpdateGoal(deps);
  const remove = new DeleteGoal(deps);
  const record = new RecordGoalEntry(deps);
  const listEntries = new ListGoalEntries(deps);

  // Audit lines carry ids only: never the name or any amount.
  const audit = (
    message: string,
    requestId: string,
    auth: AuthContext | undefined,
    goalId: string,
  ): void => {
    logger.info({ requestId, userId: auth?.userId, goalId }, message);
  };

  return ({ requireSession }) => {
    const router = Router();
    router.use('/goals', requireSession, requireVerifiedEmail);

    router.post(
      '/goals',
      validate(
        { body: createGoalRequestSchema, response: goalResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const created = await create.execute(scope, {
            name: body.name,
            targetAmount: BigInt(body.targetAmount),
            currency: body.currency,
            targetDate: body.targetDate,
            accountId: body.accountId,
          });
          audit('goal created', requestId, auth, created.id);
          res.status(201).json(presentGoal(created));
        },
      ),
    );

    router.get(
      '/goals',
      validate({ response: listGoalsResponseSchema }, async (_input, { res, auth }) => {
        const scope = await scopeOf(policy, auth, 'read');
        res.json(presentGoalList(await list.execute(scope)));
      }),
    );

    router.get(
      '/goals/:id',
      validate(
        { params: goalIdParamsSchema, response: goalResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentGoal(await get.execute(scope, params.id)));
        },
      ),
    );

    router.patch(
      '/goals/:id',
      validate(
        {
          params: goalIdParamsSchema,
          body: updateGoalRequestSchema,
          response: goalResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const updated = await update.execute(scope, params.id, {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.targetAmount === undefined ? {} : { targetAmount: BigInt(body.targetAmount) }),
            ...(body.targetDate === undefined ? {} : { targetDate: body.targetDate }),
          });
          audit('goal updated', requestId, auth, updated.id);
          res.json(presentGoal(updated));
        },
      ),
    );

    router.delete(
      '/goals/:id',
      validate({ params: goalIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        await remove.execute(scope, params.id);
        audit('goal deleted', requestId, auth, params.id);
        res.sendStatus(204);
      }),
    );

    router.post(
      '/goals/:id/entries',
      validate(
        {
          params: goalIdParamsSchema,
          body: createGoalEntryRequestSchema,
          response: recordGoalEntryResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const recorded = await record.execute(scope, params.id, {
            kind: body.kind,
            amount: BigInt(body.amount),
          });
          // The kind is a setting-like value; the amount stays out of the log.
          audit('goal entry recorded', requestId, auth, params.id);
          res.status(201).json(presentRecordedEntry(recorded));
        },
      ),
    );

    router.get(
      '/goals/:id/entries',
      validate(
        {
          params: goalIdParamsSchema,
          query: listGoalEntriesQuerySchema,
          response: listGoalEntriesResponseSchema,
        },
        async ({ params, query }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentGoalEntries(await listEntries.execute(scope, params.id, query.limit)));
        },
      ),
    );

    return router;
  };
}
