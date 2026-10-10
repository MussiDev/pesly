import {
  addGhostMemberRequestSchema,
  claimGhostRequestSchema,
  claimLinkResponseSchema,
  createGroupCategoryRequestSchema,
  createGroupRequestSchema,
  groupCategoryParamsSchema,
  groupCategoryResponseSchema,
  groupDetailResponseSchema,
  groupIdParamsSchema,
  groupMemberParamsSchema,
  groupMemberResponseSchema,
  groupResponseSchema,
  invitationResponseSchema,
  joinGroupRequestSchema,
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
import { CreateGroupCategory } from '../../application/create-group-category';
import { CreateInvitation } from '../../application/create-invitation';
import { GetGroup } from '../../application/get-group';
import { JoinGroup } from '../../application/join-group';
import { ListGroupCategories } from '../../application/list-group-categories';
import { ListGroups } from '../../application/list-groups';
import { MakeAdmin } from '../../application/make-admin';
import type { Clock } from '../../application/ports/clock';
import { UpdateGroup } from '../../application/update-group';
import { UpdateGroupCategory } from '../../application/update-group-category';
import { SystemClock } from '../clock/system-clock';
import { RandomTokenSource } from '../crypto/random-token-source';
import { DrizzleGroupRepository } from '../db/drizzle-group-repository';
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

  // Audit lines carry ids only: never a token, a group name, a member name or an email.
  const audit = (
    message: string,
    requestId: string,
    auth: AuthContext | undefined,
    groupId: string,
  ): void => {
    logger.info({ requestId, userId: auth?.userId, groupId }, message);
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

    return router;
  };
}
