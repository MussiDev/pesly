import {
  confirmOccurrenceSchema,
  createRecurringPaymentSchema,
  listRecurringPaymentsResponseSchema,
  occurrenceParamsSchema,
  recurringPaymentIdParamsSchema,
  recurringPaymentResponseSchema,
  updateRecurringPaymentSchema,
  upcomingResponseSchema,
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
import { ConfirmOccurrence } from '../../application/confirm-occurrence';
import { CreateRecurringPayment } from '../../application/create-recurring-payment';
import { DeleteRecurringPayment } from '../../application/delete-recurring-payment';
import {
  GetRecurringPayment,
  ListRecurringPayments,
} from '../../application/list-recurring-payments';
import { ListUpcoming } from '../../application/list-upcoming';
import { PauseRecurringPayment } from '../../application/pause-recurring-payment';
import type { Clock } from '../../application/ports/clock';
import type { ExpenseRecorder } from '../../application/ports/expense-recorder';
import { ResumeRecurringPayment } from '../../application/resume-recurring-payment';
import { SkipOccurrence } from '../../application/skip-occurrence';
import { UpdateRecurringPayment } from '../../application/update-recurring-payment';
import { DrizzleOccurrenceRepository } from '../db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../db/drizzle-recurring-payment-repository';
import { DrizzleUserTimeZone } from '../db/drizzle-user-time-zone';
import { SystemClock } from '../system-clock';
import { presentOccurrence, presentRecurringPayment, presentUpcoming } from './recurring-presenter';

export interface RecurringRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Records confirmed occurrences through the movements rules; the movements module provides it. */
  expenses: ExpenseRecorder;
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

/** `/recurring`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createRecurringRoutes({
  db,
  logger,
  expenses,
  clock = new SystemClock(),
}: RecurringRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const deps = {
    payments: new DrizzleRecurringPaymentRepository(db),
    occurrences: new DrizzleOccurrenceRepository(db),
    timeZones: new DrizzleUserTimeZone(db),
    clock,
    expenses,
  };
  const create = new CreateRecurringPayment(deps);
  const list = new ListRecurringPayments(deps);
  const get = new GetRecurringPayment(deps);
  const update = new UpdateRecurringPayment(deps);
  const pause = new PauseRecurringPayment(deps);
  const resume = new ResumeRecurringPayment(deps);
  const remove = new DeleteRecurringPayment(deps);
  const upcoming = new ListUpcoming(deps);
  const confirm = new ConfirmOccurrence(deps);
  const skip = new SkipOccurrence(deps);

  // Audit lines carry ids only: never the payment name or any amount.
  const audit = (
    message: string,
    requestId: string,
    auth: AuthContext | undefined,
    ids: object,
  ) => {
    logger.info({ requestId, userId: auth?.userId, ...ids }, message);
  };

  return ({ requireSession }) => {
    const router = Router();
    router.use('/recurring', requireSession, requireVerifiedEmail);

    router.post(
      '/recurring/payments',
      validate(
        { body: createRecurringPaymentSchema, response: recurringPaymentResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const created = await create.execute(scope, { ...body, amount: BigInt(body.amount) });
          audit('recurring payment created', requestId, auth, { paymentId: created.id });
          res.status(201).json(presentRecurringPayment(await get.execute(scope, created.id)));
        },
      ),
    );

    router.get(
      '/recurring/payments',
      validate({ response: listRecurringPaymentsResponseSchema }, async (_input, { res, auth }) => {
        const scope = await scopeOf(policy, auth, 'read');
        res.json({ items: (await list.execute(scope)).map(presentRecurringPayment) });
      }),
    );

    // Declared before the `/:id` routes so the path is never read as a payment id.
    router.get(
      '/recurring/upcoming',
      validate({ response: upcomingResponseSchema }, async (_input, { res, auth }) => {
        // Reading materializes the due occurrences first, so it needs a write scope.
        const scope = await scopeOf(policy, auth, 'write');
        res.json(presentUpcoming(await upcoming.execute(scope)));
      }),
    );

    router.get(
      '/recurring/payments/:id',
      validate(
        { params: recurringPaymentIdParamsSchema, response: recurringPaymentResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentRecurringPayment(await get.execute(scope, params.id)));
        },
      ),
    );

    router.patch(
      '/recurring/payments/:id',
      validate(
        {
          params: recurringPaymentIdParamsSchema,
          body: updateRecurringPaymentSchema,
          response: recurringPaymentResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          await update.execute(scope, params.id, {
            ...body,
            amount: body.amount === undefined ? undefined : BigInt(body.amount),
          });
          audit('recurring payment changed', requestId, auth, { paymentId: params.id });
          res.json(presentRecurringPayment(await get.execute(scope, params.id)));
        },
      ),
    );

    for (const [action, useCase, message] of [
      ['pause', pause, 'recurring payment paused'],
      ['resume', resume, 'recurring payment resumed'],
    ] as const) {
      router.post(
        `/recurring/payments/:id/${action}`,
        validate(
          { params: recurringPaymentIdParamsSchema, response: recurringPaymentResponseSchema },
          async ({ params }, { res, auth, requestId }) => {
            const scope = await scopeOf(policy, auth, 'write');
            await useCase.execute(scope, params.id);
            audit(message, requestId, auth, { paymentId: params.id });
            res.json(presentRecurringPayment(await get.execute(scope, params.id)));
          },
        ),
      );
    }

    router.delete(
      '/recurring/payments/:id',
      validate(
        { params: recurringPaymentIdParamsSchema },
        async ({ params }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          await remove.execute(scope, params.id);
          audit('recurring payment deleted', requestId, auth, { paymentId: params.id });
          res.sendStatus(204);
        },
      ),
    );

    router.post(
      '/recurring/occurrences/:id/confirm',
      validate(
        { params: occurrenceParamsSchema, body: confirmOccurrenceSchema },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const occurrence = await confirm.execute(scope, params.id, {
            amount: body.amount === undefined ? undefined : BigInt(body.amount),
            date: body.date,
          });
          // Ids only: never the amount.
          audit('recurring occurrence confirmed', requestId, auth, {
            occurrenceId: occurrence.id,
            paymentId: occurrence.paymentId,
            movementId: occurrence.movementId,
          });
          res.json(presentOccurrence(occurrence));
        },
      ),
    );

    router.post(
      '/recurring/occurrences/:id/skip',
      validate({ params: occurrenceParamsSchema }, async ({ params }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        const occurrence = await skip.execute(scope, params.id);
        audit('recurring occurrence skipped', requestId, auth, {
          occurrenceId: occurrence.id,
          paymentId: occurrence.paymentId,
        });
        res.json(presentOccurrence(occurrence));
      }),
    );

    return router;
  };
}
