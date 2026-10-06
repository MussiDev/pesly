import {
  cardExpenseResponseSchema,
  createCardExpenseRequestSchema,
  createCreditCardRequestSchema,
  creditCardIdParamsSchema,
  creditCardResponseSchema,
  listCreditCardsResponseSchema,
  listStatementsResponseSchema,
  statementParamsSchema,
  statementResponseSchema,
  updateCreditCardRequestSchema,
  updateStatementRequestSchema,
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
import { CreateCreditCard } from '../../application/create-credit-card';
import { DeleteCreditCard } from '../../application/delete-credit-card';
import { GetCreditCard } from '../../application/get-credit-card';
import { ListCreditCards } from '../../application/list-credit-cards';
import { ListStatements } from '../../application/list-statements';
import type { AccountActivity } from '../../application/ports/account-activity';
import type { CardPurchases } from '../../application/ports/card-purchases';
import type { Clock } from '../../application/ports/clock';
import type { ExpenseRecorder } from '../../application/ports/expense-recorder';
import { RecordCardExpense } from '../../application/record-card-expense';
import { UpdateCreditCardDays } from '../../application/update-credit-card-days';
import { UpdateStatementDates } from '../../application/update-statement-dates';
import { DrizzleCreditCardRepository } from '../db/drizzle-credit-card-repository';
import { DrizzleUserTimeZone } from '../db/drizzle-user-time-zone';
import { SystemClock } from '../system-clock';
import { presentCardExpense, presentCreditCard, presentStatement } from './credit-card-presenter';

export interface CreditCardRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Whether a linked account has movements; the movements module provides it (spec D10). */
  activity: AccountActivity;
  /** Records the card expenses through the movements rules; the movements module provides it (spec D7). */
  expenses: ExpenseRecorder;
  /** Daily purchase sums behind the statement totals; the movements module provides it. */
  purchases: CardPurchases;
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

/** `/credit-cards`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createCreditCardRoutes({
  db,
  logger,
  activity,
  expenses,
  purchases,
  clock = new SystemClock(),
}: CreditCardRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const deps = {
    cards: new DrizzleCreditCardRepository(db),
    activity,
    expenses,
    purchases,
    timeZones: new DrizzleUserTimeZone(db),
    clock,
  };
  const createCard = new CreateCreditCard(deps);
  const listCards = new ListCreditCards(deps);
  const getCard = new GetCreditCard(deps);
  const updateDays = new UpdateCreditCardDays(deps);
  const deleteCard = new DeleteCreditCard(deps);
  const listStatements = new ListStatements(deps);
  const updateStatement = new UpdateStatementDates(deps);
  const recordExpense = new RecordCardExpense(deps);

  // Audit lines carry ids only: never the card name.
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
    router.use('/credit-cards', requireSession, requireVerifiedEmail);

    router.post(
      '/credit-cards',
      validate(
        { body: createCreditCardRequestSchema, response: creditCardResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const card = await createCard.execute(scope, body);
          audit('credit card created', requestId, auth, { cardId: card.id });
          res.status(201).json(presentCreditCard(card));
        },
      ),
    );

    router.get(
      '/credit-cards',
      validate({ response: listCreditCardsResponseSchema }, async (_input, { res, auth }) => {
        const scope = await scopeOf(policy, auth, 'read');
        res.json({ items: (await listCards.execute(scope)).map(presentCreditCard) });
      }),
    );

    router.get(
      '/credit-cards/:id',
      validate(
        { params: creditCardIdParamsSchema, response: creditCardResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentCreditCard(await getCard.execute(scope, params.id)));
        },
      ),
    );

    router.patch(
      '/credit-cards/:id',
      validate(
        {
          params: creditCardIdParamsSchema,
          body: updateCreditCardRequestSchema,
          response: creditCardResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const card = await updateDays.execute(scope, params.id, body);
          audit('credit card days changed', requestId, auth, { cardId: card.id });
          res.json(presentCreditCard(card));
        },
      ),
    );

    router.delete(
      '/credit-cards/:id',
      validate(
        { params: creditCardIdParamsSchema },
        async ({ params }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          await deleteCard.execute(scope, params.id);
          audit('credit card deleted', requestId, auth, { cardId: params.id });
          res.sendStatus(204);
        },
      ),
    );

    // A read that may create the missing cycles first (user decision D6), so it takes a write scope.
    router.get(
      '/credit-cards/:id/statements',
      validate(
        { params: creditCardIdParamsSchema, response: listStatementsResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const statements = await listStatements.execute(scope, params.id);
          res.json({ items: statements.map(presentStatement) });
        },
      ),
    );

    router.patch(
      '/credit-cards/:id/statements/:statementId',
      validate(
        {
          params: statementParamsSchema,
          body: updateStatementRequestSchema,
          response: statementResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const statement = await updateStatement.execute(
            scope,
            params.id,
            params.statementId,
            body,
          );
          audit('statement dates changed', requestId, auth, {
            cardId: params.id,
            statementId: statement.id,
          });
          res.json(presentStatement(statement));
        },
      ),
    );

    router.post(
      '/credit-cards/:id/expenses',
      validate(
        {
          params: creditCardIdParamsSchema,
          body: createCardExpenseRequestSchema,
          response: cardExpenseResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const expense = await recordExpense.execute(scope, params.id, {
            currency: body.currency,
            categoryId: body.categoryId,
            amount: BigInt(body.amount),
            occurredAt: new Date(body.occurredAt),
            ...(body.note === undefined ? {} : { note: body.note }),
            rate:
              body.rate.source === 'manual'
                ? { source: 'manual', value: BigInt(body.rate.value) }
                : { source: 'automatic' },
          });
          // Ids only: never the amount or the note.
          audit('card expense recorded', requestId, auth, {
            cardId: params.id,
            movementId: expense.movementId,
          });
          res.status(201).json(presentCardExpense(expense));
        },
      ),
    );

    return router;
  };
}
