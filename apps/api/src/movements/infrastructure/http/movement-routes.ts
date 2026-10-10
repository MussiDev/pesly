import {
  createMovementRequestSchema,
  listMovementsQuerySchema,
  listMovementsResponseSchema,
  movementIdParamsSchema,
  movementResponseSchema,
  updateMovementRequestSchema,
} from '@pesly/shared';
import { Router } from 'express';
import type { z } from 'zod';
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
import {
  CreateMovement,
  type CategorizedMovementInput,
  type CreateMovementInput,
  type ExchangeInput,
  type TransferInput,
} from '../../application/create-movement';
import type {
  EditCategorizedMovementInput,
  EditMovementInput,
} from '../../application/build-new-movement';
import { DeleteMovement } from '../../application/delete-movement';
import { GetMovement } from '../../application/get-movement';
import { ListMovements } from '../../application/list-movements';
import type { Clock } from '../../application/ports/clock';
import { RecordDeviceMovement } from '../../application/record-device-movement';
import { RecordManualMovement } from '../../application/record-manual-movement';
import { UpdateMovement } from '../../application/update-movement';
import { DrizzleAccountLookup } from '../db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../db/drizzle-movement-repository';
import { DrizzleMovementWriteLimiter } from '../db/drizzle-movement-write-limiter';
import { DrizzleRateLookup } from '../db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../db/drizzle-user-preferences';
import { SystemClock } from '../system-clock';
import { presentMovement, presentMovementList } from './movement-presenter';

export interface MovementRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Manual creations per user per minute (default 60); the performance test raises it. */
  writeLimit?: number;
  /** Creations that carry a device id per user per minute (default 600), counted apart from the manual ones. */
  deviceWriteLimit?: number;
  /** Defaults to the system clock; tests inject one to cross the limiter windows. */
  clock?: Clock;
}

type CreateBody = z.infer<typeof createMovementRequestSchema>;
type UpdateBody = z.infer<typeof updateMovementRequestSchema>;
type ExpenseOrIncomeUpdateBody = Extract<UpdateBody, { type: 'expense' | 'income' }>;
type ExpenseOrIncomeBody = Extract<CreateBody, { type: 'expense' | 'income' }>;
type TransferBody = Extract<CreateBody, { type: 'transfer' }>;
type ExchangeBody = Extract<CreateBody, { type: 'exchange' }>;

/** Everything an expense or income carries except the rate, which a creation and an edit read differently. */
function categorizedFields(body: ExpenseOrIncomeBody | ExpenseOrIncomeUpdateBody) {
  return {
    type: body.type,
    accountId: body.accountId,
    categoryId: body.categoryId,
    amount: BigInt(body.amount),
    ...(body.tags === undefined ? {} : { tags: body.tags }),
    occurredAt: new Date(body.occurredAt),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

function categorizedInput(body: ExpenseOrIncomeBody): CategorizedMovementInput {
  return {
    ...categorizedFields(body),
    rate:
      body.rate.source === 'automatic'
        ? { source: 'automatic' }
        : { source: 'manual', value: BigInt(body.rate.value) },
  };
}

function editCategorizedInput(body: ExpenseOrIncomeUpdateBody): EditCategorizedMovementInput {
  switch (body.rate.source) {
    case 'keep':
      return { ...categorizedFields(body), rate: { source: 'keep' } };
    case 'automatic':
      return { ...categorizedFields(body), rate: { source: 'automatic' } };
    case 'manual':
      return {
        ...categorizedFields(body),
        rate: { source: 'manual', value: BigInt(body.rate.value) },
      };
  }
}

function transferInput(body: TransferBody): TransferInput {
  return {
    type: 'transfer',
    accountId: body.accountId,
    destinationAccountId: body.destinationAccountId,
    amount: BigInt(body.amount),
    occurredAt: new Date(body.occurredAt),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

function exchangeInput(body: ExchangeBody): ExchangeInput {
  return {
    type: 'exchange',
    accountId: body.accountId,
    destinationAccountId: body.destinationAccountId,
    amount: BigInt(body.amount),
    destinationAmount: BigInt(body.destinationAmount),
    occurredAt: new Date(body.occurredAt),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

function toCreateInput(body: CreateBody): CreateMovementInput {
  switch (body.type) {
    case 'expense':
    case 'income':
      return categorizedInput(body);
    case 'transfer':
      return transferInput(body);
    case 'exchange':
      return exchangeInput(body);
  }
}

function toEditInput(body: UpdateBody): EditMovementInput {
  switch (body.type) {
    case 'expense':
    case 'income':
      return editCategorizedInput(body);
    case 'transfer':
      return transferInput(body);
    case 'exchange':
      return exchangeInput(body);
  }
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

/** `/movements`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createMovementRoutes({
  db,
  logger,
  writeLimit,
  deviceWriteLimit,
  clock = new SystemClock(),
}: MovementRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const movements = new DrizzleMovementRepository(db);
  const createMovement = new CreateMovement({
    movements,
    accounts: new DrizzleAccountLookup(db),
    categories: new DrizzleCategoryLookup(db),
    rates: new DrizzleRateLookup(db),
    preferences: new DrizzleUserPreferences(db),
    clock,
  });
  const limiter = new DrizzleMovementWriteLimiter(db, clock);
  // A failed refund only makes the limit stricter; it is logged without any request data.
  const reportReleaseFailure = (error: unknown) => {
    logger.error({ err: error }, 'movement write limiter release failed');
  };
  const recordManualMovement = new RecordManualMovement(
    { createMovement, limiter, clock, reportReleaseFailure },
    writeLimit,
  );
  const recordDeviceMovement = new RecordDeviceMovement(
    { createMovement, movements, limiter, clock, reportReleaseFailure },
    deviceWriteLimit,
  );
  const listMovements = new ListMovements({
    movements,
    preferences: new DrizzleUserPreferences(db),
  });
  const getMovement = new GetMovement({ movements });
  const updateMovement = new UpdateMovement({
    movements,
    accounts: new DrizzleAccountLookup(db),
    categories: new DrizzleCategoryLookup(db),
    rates: new DrizzleRateLookup(db),
    preferences: new DrizzleUserPreferences(db),
    clock,
  });
  const deleteMovement = new DeleteMovement({ movements });

  return ({ requireSession }) => {
    const router = Router();
    router.use('/movements', requireSession, requireVerifiedEmail);

    router.post(
      '/movements',
      validate(
        { body: createMovementRequestSchema, response: movementResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const input = toCreateInput(body);
          // With an id the creation is idempotent: a replay answers 200 with the stored movement.
          const { movement, created } =
            body.id === undefined
              ? { movement: await recordManualMovement.execute(scope, input), created: true }
              : await recordDeviceMovement.execute(scope, body.id, input);
          // Ids only: never the amount, the note or the rate.
          logger.info(
            { requestId, userId: auth?.userId, movementId: movement.id },
            created ? 'movement created' : 'movement replayed',
          );
          res.status(created ? 201 : 200).json(presentMovement(movement));
        },
      ),
    );

    router.get(
      '/movements',
      validate(
        { query: listMovementsQuerySchema, response: listMovementsResponseSchema },
        async ({ query }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentMovementList(await listMovements.execute(scope, query), query));
        },
      ),
    );

    router.get(
      '/movements/:id',
      validate(
        { params: movementIdParamsSchema, response: movementResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentMovement(await getMovement.execute(scope, params.id)));
        },
      ),
    );

    router.put(
      '/movements/:id',
      validate(
        {
          params: movementIdParamsSchema,
          body: updateMovementRequestSchema,
          response: movementResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const updated = await updateMovement.execute(scope, params.id, toEditInput(body));
          // Ids only: never the amount, the note, the tags or the rate.
          logger.info(
            { requestId, userId: auth?.userId, movementId: updated.id },
            'movement updated',
          );
          res.json(presentMovement(updated));
        },
      ),
    );

    router.delete(
      '/movements/:id',
      validate({ params: movementIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        await deleteMovement.execute(scope, params.id);
        logger.info({ requestId, userId: auth?.userId, movementId: params.id }, 'movement deleted');
        res.sendStatus(204);
      }),
    );

    return router;
  };
}
