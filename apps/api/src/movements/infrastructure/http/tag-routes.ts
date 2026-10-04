import { tagSuggestionsQuerySchema, tagSuggestionsResponseSchema } from '@pesly/shared';
import { Router } from 'express';
import type { RouterFactory } from '../../../app';
import { OwnerOrGroupMemberAccessPolicy } from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import { HttpError } from '../../../shared/http/error-handler';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import { SuggestTags } from '../../application/suggest-tags';
import { DrizzleTagRepository } from '../db/drizzle-tag-repository';

export interface TagRoutesOptions {
  db: Database;
}

/** `/tags`: requireSession, requireVerifiedEmail, then the caller's own tags only. */
export function createTagRoutes({ db }: TagRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const suggestTags = new SuggestTags({ tags: new DrizzleTagRepository(db) });

  return ({ requireSession }) => {
    const router = Router();
    router.use('/tags', requireSession, requireVerifiedEmail);

    router.get(
      '/tags',
      validate(
        { query: tagSuggestionsQuerySchema, response: tagSuggestionsResponseSchema },
        async ({ query }, { res, auth }) => {
          // requireSession always sets auth before this route; failing closed keeps that explicit.
          if (!auth) throw new HttpError(401, 'UNAUTHENTICATED');
          const scope = await policy.scopeFor(auth, 'read');
          res.json({ items: await suggestTags.execute(scope, query) });
        },
      ),
    );

    return router;
  };
}
