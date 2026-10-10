import {
  listNoticesQuerySchema,
  listNoticesResponseSchema,
  markAllReadResponseSchema,
  noticeIdParamsSchema,
  noticeSchema,
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
import { ListNotices } from '../../application/list-notices';
import { MarkAllNoticesRead } from '../../application/mark-all-notices-read';
import { MarkNoticeRead } from '../../application/mark-notice-read';
import { DrizzleNoticeRepository } from '../db/drizzle-notice-repository';
import { presentNotice, presentNoticePage } from './notices-presenter';

export interface NoticesRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
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

/** `/notices`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createNoticesRoutes({ db, logger }: NoticesRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const repository = new DrizzleNoticeRepository(db);
  const list = new ListNotices(repository);
  const markRead = new MarkNoticeRead(repository);
  const markAllRead = new MarkAllNoticesRead(repository);

  // Audit lines carry ids and counts only: never the notice text.
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
    router.use('/notices', requireSession, requireVerifiedEmail);

    router.get(
      '/notices',
      validate(
        { query: listNoticesQuerySchema, response: listNoticesResponseSchema },
        async ({ query }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentNoticePage(await list.execute(scope, query)));
        },
      ),
    );

    // Declared before `/:id/read` so the path is never read as a notice id.
    router.post(
      '/notices/read-all',
      validate(
        { response: markAllReadResponseSchema },
        async (_input, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const { updated } = await markAllRead.execute(scope);
          audit('notices marked read', requestId, auth, { updated });
          res.json({ unreadCount: 0 });
        },
      ),
    );

    router.post(
      '/notices/:id/read',
      validate(
        { params: noticeIdParamsSchema, response: noticeSchema },
        async ({ params }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const notice = await markRead.execute(scope, params.id);
          audit('notice marked read', requestId, auth, { noticeId: notice.id });
          res.json(presentNotice(notice));
        },
      ),
    );

    return router;
  };
}
