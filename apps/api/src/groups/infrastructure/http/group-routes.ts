import {
  AppError,
  activityPageSchema,
  addGhostMemberRequestSchema,
  balancesResponseSchema,
  listActivityQuerySchema,
  updateGroupExpenseRequestSchema,
  updateSettlementRequestSchema,
  consolidationPreviewSchema,
  consolidationQuerySchema,
  createSettlementRequestSchema,
  listSettlementsQuerySchema,
  settlementPageSchema,
  settlementResponseSchema,
  claimGhostRequestSchema,
  claimLinkResponseSchema,
  createGroupCategoryRequestSchema,
  createGroupExpenseRequestSchema,
  createGroupRequestSchema,
  defaultSplitRequestSchema,
  defaultSplitResponseSchema,
  expenseOptionsResponseSchema,
  groupCategoryParamsSchema,
  groupCategoryResponseSchema,
  groupDetailResponseSchema,
  groupExpensePageSchema,
  groupExpenseParamsSchema,
  groupExpenseResponseSchema,
  groupIdParamsSchema,
  groupMemberParamsSchema,
  groupMemberResponseSchema,
  groupResponseSchema,
  invitationResponseSchema,
  joinGroupRequestSchema,
  listGroupExpensesQuerySchema,
  personalSharesPageSchema,
  personalSharesQuerySchema,
  updateGroupCategoryRequestSchema,
  updateGroupRequestSchema,
} from '@pesly/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { RouterFactory } from '../../../app';
import type { Database } from '../../../shared/db/client';
import type { AuthContext } from '../../../shared/http/auth-context';
import { HttpError } from '../../../shared/http/error-handler';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import { AddGhostMember } from '../../application/add-ghost-member';
import { ClaimGhostMember } from '../../application/claim-ghost-member';
import { CreateClaimLink } from '../../application/create-claim-link';
import { CreateGroup } from '../../application/create-group';
import { DeleteGroupExpense } from '../../application/delete-group-expense';
import { DeleteSettlement } from '../../application/delete-settlement';
import { GroupAccess } from '../../application/group-access';
import { ListActivity } from '../../application/list-activity';
import { UpdateGroupExpense } from '../../application/update-group-expense';
import { UpdateSettlement } from '../../application/update-settlement';
import { DrizzleActivityLogReader } from '../db/drizzle-activity-log-reader';
import { presentActivityPage } from './group-activity-presenter';
import { CreateGroupCategory } from '../../application/create-group-category';
import { CreateInvitation } from '../../application/create-invitation';
import { GetBalances } from '../../application/get-balances';
import { GetExpenseOptions } from '../../application/get-expense-options';
import { GetGroup } from '../../application/get-group';
import { GetGroupExpense } from '../../application/get-group-expense';
import { JoinGroup } from '../../application/join-group';
import { LeaveGroup } from '../../application/leave-group';
import { ListGroupCategories } from '../../application/list-group-categories';
import { ListGroupExpenses } from '../../application/list-group-expenses';
import { ListGroups } from '../../application/list-groups';
import { ListSettlements } from '../../application/list-settlements';
import { ListPersonalShares } from '../../application/list-personal-shares';
import { MakeAdmin } from '../../application/make-admin';
import type { Clock } from '../../application/ports/clock';
import { PreviewConsolidation } from '../../application/preview-consolidation';
import { RecordGroupExpense } from '../../application/record-group-expense';
import { RecordSettlement } from '../../application/record-settlement';
import { RemoveMember } from '../../application/remove-member';
import { SetDefaultSplit } from '../../application/set-default-split';
import { UpdateGroup } from '../../application/update-group';
import { UpdateGroupCategory } from '../../application/update-group-category';
import { SystemClock } from '../clock/system-clock';
import { RandomTokenSource } from '../crypto/random-token-source';
import { DrizzleSettlementAccountChecker } from '../accounts/drizzle-settlement-account-checker';
import { DrizzleGroupExpenseRepository } from '../db/drizzle-group-expense-repository';
import { DrizzleGroupRepository } from '../db/drizzle-group-repository';
import { DrizzleGroupSettlementRepository } from '../db/drizzle-group-settlement-repository';
import { DrizzlePayerMovementRecorder } from '../movements/drizzle-payer-movement-recorder';
import { DrizzleRateReader } from '../rates/drizzle-rate-reader';
import {
  presentDefaultSplit,
  presentExpenseOptions,
  presentGroupExpense,
  presentGroupExpensePage,
  presentPersonalSharesPage,
} from './group-expense-presenter';
import {
  presentBalancesResponse,
  presentConsolidationPreview,
  presentSettlement,
  presentSettlementPage,
} from './group-settlement-presenter';
import {
  presentClaimLink,
  presentGroup,
  presentGroupCategory,
  presentGroupDetail,
  presentInvitation,
  presentMember,
} from './group-presenter';

export interface GroupRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Defaults to the system clock; tests move it to cross the 7-day invitation expiry. */
  clock?: Clock;
}

const groupListResponseSchema = z.array(groupResponseSchema);
const categoryListResponseSchema = z.array(groupCategoryResponseSchema);
const groupSettlementParamsSchema = z.object({ id: z.uuid(), settlementId: z.uuid() });
const groupActivityEntryParamsSchema = z.object({ id: z.uuid(), entryId: z.uuid() });

/** requireSession always sets auth before these routes; failing closed keeps that explicit. */
function userIdOf(auth: AuthContext | undefined): string {
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED');
  return auth.userId;
}

/** `/groups`: requireSession, requireVerifiedEmail, then use cases that resolve membership first. */
export function createGroupRoutes({
  db,
  logger,
  clock = new SystemClock(),
}: GroupRoutesOptions): RouterFactory {
  const groups = new DrizzleGroupRepository(db);
  const payerMovements = new DrizzlePayerMovementRecorder(db, clock);
  const expenses = new DrizzleGroupExpenseRepository(db, payerMovements);
  const tokens = new RandomTokenSource();
  const createGroup = new CreateGroup({ groups });
  const listGroups = new ListGroups({ groups });
  const getGroup = new GetGroup({ groups });
  const updateGroup = new UpdateGroup({ groups });
  const createInvitation = new CreateInvitation({ groups, clock, tokens });
  const joinGroup = new JoinGroup({ groups, clock, tokens });
  const addGhostMember = new AddGhostMember({ groups });
  const createClaimLink = new CreateClaimLink({ groups, tokens });
  const claimGhostMember = new ClaimGhostMember({ groups, clock, tokens });
  const makeAdmin = new MakeAdmin({ groups });
  const listCategories = new ListGroupCategories({ groups });
  const createCategory = new CreateGroupCategory({ groups });
  const updateCategory = new UpdateGroupCategory({ groups, clock });
  const recordExpense = new RecordGroupExpense({ groups, expenses, payerMovements, clock });
  const listExpenses = new ListGroupExpenses({ groups, expenses });
  const getExpense = new GetGroupExpense({ groups, expenses });
  const getExpenseOptions = new GetExpenseOptions({ groups, expenses });
  const setDefaultSplit = new SetDefaultSplit({ groups, expenses });
  const listPersonalShares = new ListPersonalShares({ expenses });
  const settlements = new DrizzleGroupSettlementRepository(db);
  const rates = new DrizzleRateReader(db);
  const getBalances = new GetBalances({ groups, settlements });
  const recordSettlement = new RecordSettlement({
    groups,
    settlements,
    accounts: new DrizzleSettlementAccountChecker(db),
    rates,
    clock,
  });
  const previewConsolidation = new PreviewConsolidation({ groups, settlements, rates });
  const listSettlements = new ListSettlements({ groups, settlements });
  const updateExpense = new UpdateGroupExpense({ groups, expenses, clock });
  const deleteExpense = new DeleteGroupExpense({ groups, expenses, clock });
  const updateSettlement = new UpdateSettlement({ groups, settlements, clock });
  const deleteSettlement = new DeleteSettlement({ groups, settlements, clock });
  const listActivity = new ListActivity({ groups, activity: new DrizzleActivityLogReader(db) });
  const groupAccess = new GroupAccess(groups);
  const removeMember = new RemoveMember({ groups, clock });
  const leaveGroup = new LeaveGroup({ groups, clock });

  // Audit lines carry ids only: never a token, a group name, a member name or an email.
  const audit = (
    message: string,
    requestId: string,
    auth: AuthContext | undefined,
    groupId: string,
    extra: { expenseId?: string; settlementId?: string; memberId?: string } = {},
  ): void => {
    logger.info({ requestId, userId: auth?.userId, groupId, ...extra }, message);
  };

  return ({ requireSession }) => {
    const router = Router();
    router.use('/groups', requireSession, requireVerifiedEmail);

    router.post(
      '/groups',
      validate(
        { body: createGroupRequestSchema, response: groupResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const created = await createGroup.execute(userIdOf(auth), body);
          audit('group created', requestId, auth, created.group.id);
          res.status(201).json(presentGroup(created));
        },
      ),
    );

    router.get(
      '/groups',
      validate({ response: groupListResponseSchema }, async (_input, { res, auth }) => {
        res.json((await listGroups.execute(userIdOf(auth))).map(presentGroup));
      }),
    );

    // Literal paths come before `/groups/:id` so they are never read as a group id.
    router.post(
      '/groups/join',
      validate(
        { body: joinGroupRequestSchema, response: groupResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const joined = await joinGroup.execute(userIdOf(auth), body.token);
          audit('group joined', requestId, auth, joined.group.id);
          res.json(presentGroup(joined));
        },
      ),
    );

    router.post(
      '/groups/claim',
      validate(
        { body: claimGhostRequestSchema, response: groupResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const claimed = await claimGhostMember.execute(userIdOf(auth), body.token);
          audit('ghost member claimed', requestId, auth, claimed.group.id);
          res.json(presentGroup(claimed));
        },
      ),
    );

    // Before `/groups/:id/...` so `personal` is never read as a group id.
    router.get(
      '/groups/personal/shares',
      validate(
        { query: personalSharesQuerySchema, response: personalSharesPageSchema },
        async ({ query }, { res, auth }) => {
          const page = await listPersonalShares.execute(userIdOf(auth), {
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
            ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
            ...(query.from !== undefined ? { from: new Date(query.from) } : {}),
            ...(query.to !== undefined ? { to: new Date(query.to) } : {}),
          });
          res.json(presentPersonalSharesPage(page));
        },
      ),
    );

    router.get(
      '/groups/:id',
      validate(
        { params: groupIdParamsSchema, response: groupDetailResponseSchema },
        async ({ params }, { res, auth }) => {
          res.json(presentGroupDetail(await getGroup.execute(userIdOf(auth), params.id)));
        },
      ),
    );

    router.patch(
      '/groups/:id',
      validate(
        {
          params: groupIdParamsSchema,
          body: updateGroupRequestSchema,
          response: groupResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const updated = await updateGroup.execute(userIdOf(auth), params.id, body);
          audit('group rate type changed', requestId, auth, params.id);
          res.json(presentGroup(updated));
        },
      ),
    );

    router.post(
      '/groups/:id/invitations',
      validate(
        { params: groupIdParamsSchema, response: invitationResponseSchema },
        async ({ params }, { res, auth, requestId }) => {
          const invitation = await createInvitation.execute(userIdOf(auth), params.id);
          audit('group invitation created', requestId, auth, params.id);
          res.status(201).json(presentInvitation(invitation));
        },
      ),
    );

    router.post(
      '/groups/:id/ghost-members',
      validate(
        {
          params: groupIdParamsSchema,
          body: addGhostMemberRequestSchema,
          response: groupMemberResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const member = await addGhostMember.execute(userIdOf(auth), params.id, body);
          audit('ghost member added', requestId, auth, params.id);
          res.status(201).json(presentMember(member));
        },
      ),
    );

    router.post(
      '/groups/:id/members/:memberId/claim-links',
      validate(
        { params: groupMemberParamsSchema, response: claimLinkResponseSchema },
        async ({ params }, { res, auth, requestId }) => {
          const link = await createClaimLink.execute(userIdOf(auth), params.id, params.memberId);
          audit('claim link created', requestId, auth, params.id);
          res.status(201).json(presentClaimLink(link));
        },
      ),
    );

    router.post(
      '/groups/:id/members/:memberId/admin',
      validate(
        { params: groupMemberParamsSchema, response: groupMemberResponseSchema },
        async ({ params }, { res, auth, requestId }) => {
          const member = await makeAdmin.execute(userIdOf(auth), params.id, params.memberId);
          audit('member made admin', requestId, auth, params.id);
          res.json(presentMember(member));
        },
      ),
    );

    router.get(
      '/groups/:id/categories',
      validate(
        { params: groupIdParamsSchema, response: categoryListResponseSchema },
        async ({ params }, { res, auth }) => {
          const categories = await listCategories.execute(userIdOf(auth), params.id);
          res.json(categories.map(presentGroupCategory));
        },
      ),
    );

    router.post(
      '/groups/:id/categories',
      validate(
        {
          params: groupIdParamsSchema,
          body: createGroupCategoryRequestSchema,
          response: groupCategoryResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const category = await createCategory.execute(userIdOf(auth), params.id, body);
          audit('group category created', requestId, auth, params.id);
          res.status(201).json(presentGroupCategory(category));
        },
      ),
    );

    router.patch(
      '/groups/:id/categories/:categoryId',
      validate(
        {
          params: groupCategoryParamsSchema,
          body: updateGroupCategoryRequestSchema,
          response: groupCategoryResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const category = await updateCategory.execute(
            userIdOf(auth),
            params.id,
            params.categoryId,
            body,
          );
          audit('group category updated', requestId, auth, params.id);
          res.json(presentGroupCategory(category));
        },
      ),
    );

    router.post(
      '/groups/:id/expenses',
      validate(
        {
          params: groupIdParamsSchema,
          body: createGroupExpenseRequestSchema,
          response: groupExpenseResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const expense = await recordExpense.execute(userIdOf(auth), params.id, body);
          audit('group expense created', requestId, auth, params.id, { expenseId: expense.id });
          res.status(201).json(presentGroupExpense(expense));
        },
      ),
    );

    router.get(
      '/groups/:id/expenses',
      validate(
        {
          params: groupIdParamsSchema,
          query: listGroupExpensesQuerySchema,
          response: groupExpensePageSchema,
        },
        async ({ params, query }, { res, auth }) => {
          res.json(
            presentGroupExpensePage(await listExpenses.execute(userIdOf(auth), params.id, query)),
          );
        },
      ),
    );

    router.get(
      '/groups/:id/expenses/:expenseId',
      validate(
        { params: groupExpenseParamsSchema, response: groupExpenseResponseSchema },
        async ({ params }, { res, auth }) => {
          const expense = await getExpense.execute(userIdOf(auth), params.id, params.expenseId);
          res.json(presentGroupExpense(expense));
        },
      ),
    );

    router.put(
      '/groups/:id/expenses/:expenseId',
      validate(
        {
          params: groupExpenseParamsSchema,
          body: updateGroupExpenseRequestSchema,
          response: groupExpenseResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const expense = await updateExpense.execute(
            userIdOf(auth),
            params.id,
            params.expenseId,
            body,
          );
          audit('group expense updated', requestId, auth, params.id, { expenseId: expense.id });
          res.json(presentGroupExpense(expense));
        },
      ),
    );

    router.delete(
      '/groups/:id/expenses/:expenseId',
      validate({ params: groupExpenseParamsSchema }, async ({ params }, ctx) => {
        await deleteExpense.execute(userIdOf(ctx.auth), params.id, params.expenseId);
        audit('group expense deleted', ctx.requestId, ctx.auth, params.id, {
          expenseId: params.expenseId,
        });
        ctx.res.sendStatus(204);
      }),
    );

    router.get(
      '/groups/:id/expense-options',
      validate(
        { params: groupIdParamsSchema, response: expenseOptionsResponseSchema },
        async ({ params }, { res, auth }) => {
          res.json(
            presentExpenseOptions(await getExpenseOptions.execute(userIdOf(auth), params.id)),
          );
        },
      ),
    );

    router.put(
      '/groups/:id/default-split',
      validate(
        {
          params: groupIdParamsSchema,
          body: defaultSplitRequestSchema,
          response: defaultSplitResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const split = await setDefaultSplit.execute(userIdOf(auth), params.id, body);
          audit('group default split changed', requestId, auth, params.id);
          res.json(presentDefaultSplit(split));
        },
      ),
    );

    router.get(
      '/groups/:id/balances',
      validate(
        { params: groupIdParamsSchema, response: balancesResponseSchema },
        async ({ params }, { res, auth }) => {
          res.json(presentBalancesResponse(await getBalances.execute(userIdOf(auth), params.id)));
        },
      ),
    );

    router.post(
      '/groups/:id/settlements',
      validate(
        {
          params: groupIdParamsSchema,
          body: createSettlementRequestSchema,
          response: settlementResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const settlement = await recordSettlement.execute(userIdOf(auth), params.id, body);
          audit('group settlement created', requestId, auth, params.id, {
            settlementId: settlement.id,
          });
          res.status(201).json(presentSettlement(settlement));
        },
      ),
    );

    router.get(
      '/groups/:id/settlements',
      validate(
        {
          params: groupIdParamsSchema,
          query: listSettlementsQuerySchema,
          response: settlementPageSchema,
        },
        async ({ params, query }, { res, auth }) => {
          res.json(
            presentSettlementPage(await listSettlements.execute(userIdOf(auth), params.id, query)),
          );
        },
      ),
    );

    // A literal segment, registered before any `/groups/:id/settlements/:settlementId` pattern.
    router.get(
      '/groups/:id/settlements/consolidation',
      validate(
        {
          params: groupIdParamsSchema,
          query: consolidationQuerySchema,
          response: consolidationPreviewSchema,
        },
        async ({ params, query }, { res, auth }) => {
          res.json(
            presentConsolidationPreview(
              await previewConsolidation.execute(userIdOf(auth), params.id, query),
            ),
          );
        },
      ),
    );

    router.patch(
      '/groups/:id/settlements/:settlementId',
      validate(
        {
          params: groupSettlementParamsSchema,
          body: updateSettlementRequestSchema,
          response: settlementResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const settlement = await updateSettlement.execute(
            userIdOf(auth),
            params.id,
            params.settlementId,
            body,
          );
          audit('group settlement updated', requestId, auth, params.id, {
            settlementId: settlement.id,
          });
          res.json(presentSettlement(settlement));
        },
      ),
    );

    router.delete(
      '/groups/:id/settlements/:settlementId',
      validate({ params: groupSettlementParamsSchema }, async ({ params }, ctx) => {
        await deleteSettlement.execute(userIdOf(ctx.auth), params.id, params.settlementId);
        audit('group settlement deleted', ctx.requestId, ctx.auth, params.id, {
          settlementId: params.settlementId,
        });
        ctx.res.sendStatus(204);
      }),
    );

    router.get(
      '/groups/:id/activity',
      validate(
        {
          params: groupIdParamsSchema,
          query: listActivityQuerySchema,
          response: activityPageSchema,
        },
        async ({ params, query }, { res, auth }) => {
          res.json(
            presentActivityPage(await listActivity.execute(userIdOf(auth), params.id, query)),
          );
        },
      ),
    );

    // The log is append-only (spec D8): members get a stable 405, after the membership check so a
    // non-member still gets 404. The error handler sets the empty `Allow` header.
    for (const method of ['put', 'patch', 'delete'] as const) {
      router[method](
        '/groups/:id/activity/:entryId',
        validate({ params: groupActivityEntryParamsSchema }, async ({ params }, { auth }) => {
          await groupAccess.member(userIdOf(auth), params.id);
          throw new AppError('GROUP_ACTIVITY_LOG_IMMUTABLE');
        }),
      );
    }

    router.delete(
      '/groups/:id/members/:memberId',
      validate(
        { params: groupMemberParamsSchema },
        async ({ params }, { res, auth, requestId }) => {
          await removeMember.execute(userIdOf(auth), params.id, params.memberId);
          audit('group member removed', requestId, auth, params.id, { memberId: params.memberId });
          res.sendStatus(204);
        },
      ),
    );

    router.post(
      '/groups/:id/leave',
      validate({ params: groupIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
        const memberId = await leaveGroup.execute(userIdOf(auth), params.id);
        audit('group member left', requestId, auth, params.id, { memberId });
        res.sendStatus(204);
      }),
    );

    return router;
  };
}
