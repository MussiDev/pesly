import {
  accountIdParamsSchema,
  accountResponseSchema,
  createAccountRequestSchema,
  listAccountsQuerySchema,
  listAccountsResponseSchema,
  renameAccountRequestSchema,
  setIncludeInAvailableRequestSchema,
  setOpeningBalanceRequestSchema,
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
import type { AccountMovements } from '../../application/ports/account-movements';
import { CreateAccount } from '../../application/create-account';
import { DeleteAccount } from '../../application/delete-account';
import { GetAccount } from '../../application/get-account';
import { ListAccounts } from '../../application/list-accounts';
import { RenameAccount } from '../../application/rename-account';
import { SetAccountArchived } from '../../application/set-account-archived';
import { SetIncludeInAvailable } from '../../application/set-include-in-available';
import { SetOpeningBalance } from '../../application/set-opening-balance';
import { DrizzleAccountRepository } from '../db/drizzle-account-repository';
import type { AccountLinks } from '../../application/ports/account-links';
import { NoLinksAdapter } from '../links/no-links-adapter';
import { NoMovementsAdapter } from '../movements/no-movements-adapter';
import { presentAccount, presentAccountList } from './account-presenter';

export interface AccountRoutesOptions {
  db: Database;
  /** Defaults to the adapter that reports no movements (until PRD 03). */
  movements?: AccountMovements;
  /** Defaults to the adapter that reports no links; the credit-cards module provides the real one. */
  links?: AccountLinks;
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

/** `/accounts`: requireSession, requireVerifiedEmail, then scoped use cases (see the fixture template). */
export function createAccountRoutes({
  db,
  movements = new NoMovementsAdapter(),
  links = new NoLinksAdapter(),
  logger,
}: AccountRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const accounts = new DrizzleAccountRepository(db);
  const createAccount = new CreateAccount({ accounts });
  const getAccount = new GetAccount({ accounts, movements });
  const listAccounts = new ListAccounts({ accounts, movements });
  const renameAccount = new RenameAccount({ accounts, movements });
  const setArchived = new SetAccountArchived({ accounts, movements });
  const setIncludeInAvailable = new SetIncludeInAvailable({ accounts, movements });
  const setOpeningBalance = new SetOpeningBalance({ accounts, movements });
  const deleteAccount = new DeleteAccount({ accounts, movements, links });

  // Audit lines carry ids only: never the name or any amount.
  const audit = (
    message: string,
    requestId: string,
    auth: AuthContext | undefined,
    id: string,
  ): void => {
    logger.info({ requestId, userId: auth?.userId, accountId: id }, message);
  };

  return ({ requireSession }) => {
    const router = Router();
    router.use('/accounts', requireSession, requireVerifiedEmail);

    router.post(
      '/accounts',
      validate(
        { body: createAccountRequestSchema, response: accountResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const created = await createAccount.execute(scope, {
            name: body.name,
            type: body.type,
            currency: body.currency,
            openingBalance: BigInt(body.openingBalance),
            ...(body.includeInAvailable === undefined
              ? {}
              : { includeInAvailable: body.includeInAvailable }),
          });
          audit('account created', requestId, auth, created.id);
          res.status(201).json(presentAccount(created));
        },
      ),
    );

    router.get(
      '/accounts',
      validate(
        { query: listAccountsQuerySchema, response: listAccountsResponseSchema },
        async ({ query }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          const list = await listAccounts.execute(scope, query);
          res.json(presentAccountList(list, query));
        },
      ),
    );

    router.get(
      '/accounts/:id',
      validate(
        { params: accountIdParamsSchema, response: accountResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentAccount(await getAccount.execute(scope, params.id)));
        },
      ),
    );

    router.patch(
      '/accounts/:id',
      validate(
        {
          params: accountIdParamsSchema,
          body: renameAccountRequestSchema,
          response: accountResponseSchema,
        },
        async ({ params, body }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'write');
          res.json(presentAccount(await renameAccount.execute(scope, params.id, body.name)));
        },
      ),
    );

    router.patch(
      '/accounts/:id/opening-balance',
      validate(
        {
          params: accountIdParamsSchema,
          body: setOpeningBalanceRequestSchema,
          response: accountResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const account = await setOpeningBalance.execute(
            scope,
            params.id,
            BigInt(body.openingBalance),
          );
          // Ids only: the old and the new amount are financial data and stay out of the log.
          audit('account opening balance changed', requestId, auth, account.id);
          res.json(presentAccount(account));
        },
      ),
    );

    router.put(
      '/accounts/:id/include-in-available',
      validate(
        {
          params: accountIdParamsSchema,
          body: setIncludeInAvailableRequestSchema,
          response: accountResponseSchema,
        },
        async ({ params, body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const account = await setIncludeInAvailable.execute(
            scope,
            params.id,
            body.includeInAvailable,
          );
          // The boolean is the only setting value logged; never the name or an amount.
          logger.info(
            {
              requestId,
              userId: auth?.userId,
              accountId: account.id,
              includeInAvailable: body.includeInAvailable,
            },
            'account include-in-available changed',
          );
          res.json(presentAccount(account));
        },
      ),
    );

    for (const [action, archived, message] of [
      ['archive', true, 'account archived'],
      ['unarchive', false, 'account unarchived'],
    ] as const) {
      router.post(
        `/accounts/:id/${action}`,
        validate(
          { params: accountIdParamsSchema, response: accountResponseSchema },
          async ({ params }, { res, auth, requestId }) => {
            const scope = await scopeOf(policy, auth, 'write');
            const account = await setArchived.execute(scope, params.id, archived);
            audit(message, requestId, auth, account.id);
            res.json(presentAccount(account));
          },
        ),
      );
    }

    router.delete(
      '/accounts/:id',
      validate({ params: accountIdParamsSchema }, async ({ params }, { res, auth, requestId }) => {
        const scope = await scopeOf(policy, auth, 'write');
        await deleteAccount.execute(scope, params.id);
        audit('account deleted', requestId, auth, params.id);
        res.sendStatus(204);
      }),
    );

    return router;
  };
}
