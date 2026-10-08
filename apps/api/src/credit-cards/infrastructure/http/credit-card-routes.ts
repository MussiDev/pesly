import {
  cardExpenseResponseSchema,
  createCardExpenseRequestSchema,
  createCreditCardRequestSchema,
  createInstallmentPurchaseRequestSchema,
  createStatementImportRequestSchema,
  createStatementPaymentRequestSchema,
  creditCardIdParamsSchema,
  creditCardResponseSchema,
  installmentExpensesQuerySchema,
  installmentExpensesResponseSchema,
  installmentPurchaseParamsSchema,
  installmentPurchaseResponseSchema,
  listCreditCardsResponseSchema,
  listInstallmentPurchasesResponseSchema,
  listStatementsResponseSchema,
  statementImportResponseSchema,
  statementParamsSchema,
  statementPaymentResponseSchema,
  statementResponseSchema,
  updateCreditCardRequestSchema,
  updateInstallmentPurchaseRequestSchema,
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
import { CreateInstallmentPurchase } from '../../application/create-installment-purchase';
import { DeleteCreditCard } from '../../application/delete-credit-card';
import { DeleteInstallmentPurchase } from '../../application/delete-installment-purchase';
import { GetCreditCard } from '../../application/get-credit-card';
import { GetInstallmentPurchase } from '../../application/get-installment-purchase';
import { ImportCardStatement } from '../../application/import-card-statement';
import { ListInstallmentExpenses } from '../../application/list-installment-expenses';
import { ListInstallmentPurchases } from '../../application/list-installment-purchases';
import { ListCreditCards } from '../../application/list-credit-cards';
import { ListStatements } from '../../application/list-statements';
import type { AccountActivity } from '../../application/ports/account-activity';
import type { CardPayments } from '../../application/ports/card-payments';
import type { CardPurchases } from '../../application/ports/card-purchases';
import type { Clock } from '../../application/ports/clock';
import type { ExpenseCategoryGuard } from '../../application/ports/expense-category-guard';
import type { ExpenseRecorder } from '../../application/ports/expense-recorder';
import type { InstallmentWriteLimit } from '../../application/ports/installment-write-limit';
import type { StatementPaymentRecorder } from '../../application/ports/statement-payment-recorder';
import { RecordCardExpense } from '../../application/record-card-expense';
import { RecordStatementPayment } from '../../application/record-statement-payment';
import { UpdateCreditCardDays } from '../../application/update-credit-card-days';
import { UpdateInstallmentPurchase } from '../../application/update-installment-purchase';
import { UpdateStatementDates } from '../../application/update-statement-dates';
import { DrizzleCreditCardRepository } from '../db/drizzle-credit-card-repository';
import { DrizzleInstallmentRepository } from '../db/drizzle-installment-repository';
import { DrizzleStatementImportRepository } from '../db/drizzle-statement-import-repository';
import { DrizzleUserTimeZone } from '../db/drizzle-user-time-zone';
import { SystemClock } from '../system-clock';
import {
  presentCardExpense,
  presentCreditCard,
  presentInstallmentExpenses,
  presentInstallmentPurchase,
  presentInstallmentPurchaseList,
  presentStatement,
  presentStatementPayment,
} from './credit-card-presenter';

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
  /** The category rules of a new expense; the movements module provides it (spec D7). */
  categories: ExpenseCategoryGuard;
  /** The per-user creation limit shared with the movements routes; the movements module provides it. */
  writeLimit: InstallmentWriteLimit;
  /** What each card received, behind the statement status; the movements module provides it (spec D2). */
  cardPayments: CardPayments;
  /** Records a statement payment as a transfer through the movements rules; the movements module provides it (spec D5). */
  paymentRecorder: StatementPaymentRecorder;
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
  categories,
  writeLimit,
  cardPayments,
  paymentRecorder,
  clock = new SystemClock(),
}: CreditCardRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const deps = {
    cards: new DrizzleCreditCardRepository(db),
    activity,
    expenses,
    purchases,
    categories,
    writeLimit,
    cardPayments,
    paymentRecorder,
    installments: new DrizzleInstallmentRepository(db),
    statementImports: new DrizzleStatementImportRepository(db),
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
  const recordPayment = new RecordStatementPayment(deps);
  const createPurchase = new CreateInstallmentPurchase(deps);
  const importStatement = new ImportCardStatement(deps, createPurchase);
  const listPurchases = new ListInstallmentPurchases(deps);
  const getPurchase = new GetInstallmentPurchase(deps);
  const updatePurchase = new UpdateInstallmentPurchase(deps);
  const deletePurchase = new DeleteInstallmentPurchase(deps);
  const listExpenses = new ListInstallmentExpenses(deps);

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

    // Declared before `/credit-cards/:id` so the path is never read as a card id.
    router.get(
      '/credit-cards/installment-expenses',
      validate(
        { query: installmentExpensesQuerySchema, response: installmentExpensesResponseSchema },
        async ({ query }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentInstallmentExpenses(await listExpenses.execute(scope, query)));
        },
      ),
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

    router.post(
      '/credit-cards/:id/statement-imports',
      validate(
        {
          params: creditCardIdParamsSchema,
          body: createStatementImportRequestSchema,
          response: statementImportResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const outcome = await importStatement.execute(scope, params.id, {
            closingDate: body.closingDate,
            ...(body.dueDate === undefined ? {} : { dueDate: body.dueDate }),
            categoryId: body.categoryId,
            lines: body.lines.map((line) => ({ ...line, amount: BigInt(line.amount) })),
          });
          // Counts and ids only: never a description, an amount or a voucher.
          audit('card statement imported', requestId, auth, { cardId: params.id, ...outcome });
          res.status(201).json(outcome);
        },
      ),
    );

    router.post(
      '/credit-cards/:id/payments',
      validate(
        {
          params: creditCardIdParamsSchema,
          body: createStatementPaymentRequestSchema,
          response: statementPaymentResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const payment = await recordPayment.execute(scope, params.id, {
            currency: body.currency,
            sourceAccountId: body.sourceAccountId,
            amount: BigInt(body.amount),
            occurredAt: new Date(body.occurredAt),
            ...(body.note === undefined ? {} : { note: body.note }),
          });
          // Ids only: never the amount or the note.
          audit('statement payment recorded', requestId, auth, {
            cardId: params.id,
            movementId: payment.movementId,
          });
          res.status(201).json(presentStatementPayment(payment));
        },
      ),
    );

    router.post(
      '/credit-cards/:id/installment-purchases',
      validate(
        {
          params: creditCardIdParamsSchema,
          body: createInstallmentPurchaseRequestSchema,
          response: installmentPurchaseResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const purchase = await createPurchase.execute(scope, params.id, {
            categoryId: body.categoryId,
            currency: body.currency,
            amount: BigInt(body.amount),
            installments: body.installments,
            purchasedOn: body.purchasedOn,
            ...(body.note === undefined ? {} : { note: body.note }),
          });
          // Ids only: never the amount or the note.
          audit('installment purchase recorded', requestId, auth, {
            cardId: params.id,
            purchaseId: purchase.id,
          });
          res.status(201).json(presentInstallmentPurchase(purchase));
        },
      ),
    );

    router.get(
      '/credit-cards/:id/installment-purchases',
      validate(
        { params: creditCardIdParamsSchema, response: listInstallmentPurchasesResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentInstallmentPurchaseList(await listPurchases.execute(scope, params.id)));
        },
      ),
    );

    router.get(
      '/credit-cards/:id/installment-purchases/:purchaseId',
      validate(
        { params: installmentPurchaseParamsSchema, response: installmentPurchaseResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(
            presentInstallmentPurchase(
              await getPurchase.execute(scope, params.id, params.purchaseId),
            ),
          );
        },
      ),
    );

    router.patch(
      '/credit-cards/:id/installment-purchases/:purchaseId',
      validate(
        {
          params: installmentPurchaseParamsSchema,
          body: updateInstallmentPurchaseRequestSchema,
          response: installmentPurchaseResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const purchase = await updatePurchase.execute(scope, params.id, params.purchaseId, body);
          audit('installment purchase changed', requestId, auth, {
            cardId: params.id,
            purchaseId: purchase.id,
          });
          res.json(presentInstallmentPurchase(purchase));
        },
      ),
    );

    router.delete(
      '/credit-cards/:id/installment-purchases/:purchaseId',
      validate(
        { params: installmentPurchaseParamsSchema },
        async ({ params }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          await deletePurchase.execute(scope, params.id, params.purchaseId);
          audit('installment purchase deleted', requestId, auth, {
            cardId: params.id,
            purchaseId: params.purchaseId,
          });
          res.sendStatus(204);
        },
      ),
    );

    return router;
  };
}
